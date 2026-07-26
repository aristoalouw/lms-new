import { beforeEach, describe, expect, it } from 'vitest'
import { resetAcademicClassStateForTests } from '../../server/services/academic-classes'
import {
  createLearningForumPost,
  createLearningForumThread,
  listLearningForumPosts,
  listLearningForumThreads,
  moderateLearningForumPost,
  moderateLearningForumThread,
  updateLearningForumPost,
  updateLearningForumThread,
} from '../../server/services/learning-forum'
import { learningMockState, resetLearningMockState } from '../../server/services/learning-mock'
import type { LearningForumPost, LearningForumThread } from '../../server/types/learning'
import { resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const spaceId = 'class-mgt-401-a'
const student = (id = 'student-001') => authContext(id, ['student'], ['management-s1'])
const lecturer = (id = 'advisor-001') => authContext(id, ['lecturer'], ['management-s1'])
const administrator = () => authContext('admin-001', ['administrator'], [])

function setCreatedAt<T extends LearningForumThread | LearningForumPost>(records: Map<string, T>, ids: string[], createdAt: string) {
  for (const id of ids) {
    const record = records.get(id)
    if (!record) throw new Error(`Missing forum fixture ${id}`)
    records.set(id, { ...record, createdAt })
  }
}

describe('learning forum authorization and cursor paging', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    resetMockState()
    resetAcademicClassStateForTests()
    resetLearningMockState()
  })

  it('requires participation for create and author-only edits while keeping moderation assigned to the lecturer', async () => {
    await expect(createLearningForumThread(administrator(), {
      spaceId,
      title: 'Topik administrator',
      body: { format: 'PLAIN_TEXT', text: 'Administrator tidak boleh berpartisipasi.' },
    }, 'forum-admin-thread-key-0001')).rejects.toMatchObject({ statusCode: 403 })

    const created = await createLearningForumThread(student(), {
      spaceId,
      title: 'Diskusi mahasiswa',
      body: { format: 'PLAIN_TEXT', text: 'Topik ini ditulis oleh mahasiswa.' },
    }, 'forum-student-thread-key-001')
    const postResult = await createLearningForumPost(student(), {
      threadId: created.thread.id,
      body: { format: 'PLAIN_TEXT', text: 'Balasan milik mahasiswa.' },
    }, 'forum-student-post-key-0001')

    await expect(createLearningForumPost(administrator(), {
      threadId: created.thread.id,
      body: { format: 'PLAIN_TEXT', text: 'Balasan administrator ditolak.' },
    }, 'forum-admin-post-key-00001')).rejects.toMatchObject({ statusCode: 403 })
    await expect(updateLearningForumThread(lecturer(), created.thread.id, {
      expectedVersion: postResult.thread.version,
      title: 'Diubah dosen',
      body: { format: 'PLAIN_TEXT', text: 'Moderator tidak mengubah isi penulis.' },
    })).rejects.toMatchObject({ statusCode: 403 })
    await expect(updateLearningForumPost(lecturer(), postResult.post.id, {
      expectedVersion: postResult.post.version,
      body: { format: 'PLAIN_TEXT', text: 'Moderator tidak mengubah balasan penulis.' },
    })).rejects.toMatchObject({ statusCode: 403 })
    await expect(updateLearningForumThread(administrator(), created.thread.id, {
      expectedVersion: postResult.thread.version,
      title: 'Diubah administrator',
      body: { format: 'PLAIN_TEXT', text: 'Administrator tidak memiliki izin partisipasi.' },
    })).rejects.toMatchObject({ statusCode: 403 })
    await expect(updateLearningForumPost(administrator(), postResult.post.id, {
      expectedVersion: postResult.post.version,
      body: { format: 'PLAIN_TEXT', text: 'Administrator tidak memiliki izin partisipasi.' },
    })).rejects.toMatchObject({ statusCode: 403 })

    const editedThread = await updateLearningForumThread(student(), created.thread.id, {
      expectedVersion: postResult.thread.version,
      title: 'Diskusi mahasiswa diperbarui',
      body: { format: 'PLAIN_TEXT', text: 'Penulis memperbarui topiknya sendiri.' },
    })
    const editedPost = await updateLearningForumPost(student(), postResult.post.id, {
      expectedVersion: postResult.post.version,
      body: { format: 'PLAIN_TEXT', text: 'Penulis memperbarui balasannya sendiri.' },
    })
    expect(editedThread.thread.version).toBe(postResult.thread.version + 1)
    expect(editedPost.post.version).toBe(postResult.post.version + 1)

    await expect(moderateLearningForumThread(administrator(), created.thread.id, {
      expectedVersion: editedThread.thread.version,
      status: 'LOCKED',
      reason: 'Administrator tidak ditugaskan sebagai dosen kelas.',
    })).rejects.toMatchObject({ statusCode: 403 })
    await expect(moderateLearningForumPost(lecturer('lecturer-unassigned'), postResult.post.id, {
      expectedVersion: editedPost.post.version,
      hidden: true,
      reason: 'Dosen ini tidak ditugaskan pada kelas.',
    })).rejects.toMatchObject({ statusCode: 403 })

    const moderated = await moderateLearningForumThread(lecturer(), created.thread.id, {
      expectedVersion: editedThread.thread.version,
      status: 'LOCKED',
      reason: 'Diskusi ditutup setelah tenggat kelas.',
    })
    const moderatedPost = await moderateLearningForumPost(lecturer(), postResult.post.id, {
      expectedVersion: editedPost.post.version,
      hidden: true,
      reason: 'Balasan disembunyikan sesuai aturan diskusi kelas.',
    })
    expect(moderated.thread).toMatchObject({ status: 'LOCKED', moderatedBy: 'advisor-001' })
    expect(moderatedPost.post).toMatchObject({ status: 'HIDDEN', moderatedBy: 'advisor-001' })
  })

  it('uses deterministic opaque cursors for every thread and post page, including timestamp ties', async () => {
    const threads: LearningForumThread[] = []
    for (let index = 1; index <= 3; index += 1) {
      const result = await createLearningForumThread(student(), {
        spaceId,
        title: `Topik halaman ${index}`,
        body: { format: 'PLAIN_TEXT', text: `Isi topik halaman ${index}.` },
      }, `forum-page-thread-key-000${index}`)
      threads.push(result.thread)
    }
    const tiedAt = '2026-07-27T10:00:00.000Z'
    setCreatedAt(learningMockState().forumThreads, threads.map(thread => thread.id), tiedAt)

    const threadPages = []
    const threadCursors: string[] = []
    let threadCursor: string | undefined
    do {
      const page = await listLearningForumThreads(student(), spaceId, { limit: 1, cursor: threadCursor })
      threadPages.push(...page.items)
      threadCursor = page.nextCursor
      if (threadCursor) threadCursors.push(threadCursor)
    } while (threadCursor)

    const expectedThreadIds = threads.map(thread => thread.id).sort((left, right) => right.localeCompare(left))
    expect(threadPages.map(thread => thread.id)).toEqual(expectedThreadIds)
    expect(new Set(threadPages.map(thread => thread.id)).size).toBe(3)
    expect(threadCursors).toHaveLength(2)
    expect(threadCursors.some(cursor => expectedThreadIds.includes(cursor))).toBe(false)

    const posts: LearningForumPost[] = []
    for (let index = 1; index <= 3; index += 1) {
      const result = await createLearningForumPost(student(), {
        threadId: threads[0]!.id,
        body: { format: 'PLAIN_TEXT', text: `Balasan halaman ${index}.` },
      }, `forum-page-post-key-0000${index}`)
      posts.push(result.post)
    }
    setCreatedAt(learningMockState().forumPosts, posts.map(post => post.id), tiedAt)

    const postPages = []
    const postCursors: string[] = []
    let postCursor: string | undefined
    do {
      const page = await listLearningForumPosts(student(), threads[0]!.id, { limit: 1, cursor: postCursor })
      postPages.push(...page.items)
      postCursor = page.nextCursor
      if (postCursor) postCursors.push(postCursor)
    } while (postCursor)

    const expectedPostIds = posts.map(post => post.id).sort((left, right) => right.localeCompare(left))
    expect(postPages.map(post => post.id)).toEqual(expectedPostIds)
    expect(new Set(postPages.map(post => post.id)).size).toBe(3)
    expect(postCursors).toHaveLength(2)
    expect(postCursors.some(cursor => expectedPostIds.includes(cursor))).toBe(false)
  })
})
