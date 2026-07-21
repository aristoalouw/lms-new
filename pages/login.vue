<script setup lang="ts">
definePageMeta({
  layout: 'auth',
  middleware: 'guest',
})

useHead({ title: 'Masuk' })

const config = useRuntimeConfig()
const { login, pending, authError } = useAuth()
const email = ref(config.public.demoMode ? 'alya.prameswari@kampus.ac.id' : '')
const password = ref(config.public.demoMode ? 'demo-nusa-campus' : '')
const remember = ref(false)
const showPassword = ref(false)
const localError = ref('')
const showReset = ref(false)
const resetEmail = ref('')
const resetPending = ref(false)
const resetMessage = ref('')
const resetError = ref('')
let resetIdempotencyKey = ''

const submitLogin = async () => {
  localError.value = ''

  if (!email.value.trim() || !password.value) {
    localError.value = 'Masukkan email kampus dan kata sandi Anda.'
    return
  }

  try {
    await login(email.value.trim(), password.value)
    await navigateTo('/')
  } catch {
    localError.value = authError.value || 'Login gagal. Periksa kembali akun Anda.'
  }
}

const openReset = () => {
  showReset.value = true
  resetEmail.value = email.value.trim()
  resetMessage.value = ''
  resetError.value = ''
}

const submitReset = async () => {
  resetPending.value = true
  resetMessage.value = ''
  resetError.value = ''
  try {
    if (!resetIdempotencyKey) resetIdempotencyKey = `password-reset-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
    const { data } = await useNuxtApp().$api.post<{ message: string }>('/auth/password-reset/request', {
      email: resetEmail.value.trim(),
    }, { headers: { 'Idempotency-Key': resetIdempotencyKey } })
    resetMessage.value = data.message
  } catch (error) {
    const candidate = error as { response?: { data?: { statusMessage?: string; message?: string } } }
    resetError.value = candidate.response?.data?.statusMessage || candidate.response?.data?.message || 'Permintaan belum dapat diproses. Coba kembali nanti.'
  } finally {
    resetPending.value = false
  }
}

watch(resetEmail, () => { resetIdempotencyKey = '' })
</script>

<template>
  <main class="login-page">
    <a class="visually-hidden-focusable skip-link" href="#login-form">Lewati ke formulir masuk</a>

    <section class="login-story" aria-labelledby="welcome-title">
      <div class="login-story__glow login-story__glow--one" aria-hidden="true" />
      <div class="login-story__glow login-story__glow--two" aria-hidden="true" />

      <div class="login-story__content">
        <NuxtLink class="brand-lockup" to="/" aria-label="Nusa Campus, beranda">
          <span class="brand-lockup__mark" aria-hidden="true">N</span>
          <span>
            <strong>Nusa Campus</strong>
            <small>Sistem informasi terpadu</small>
          </span>
        </NuxtLink>

        <div class="login-story__copy">
          <span class="eyebrow-pill">Satu akses untuk seluruh layanan</span>
          <h1 id="welcome-title">Kampus bekerja lebih tertata, dari pendaftaran hingga kelulusan.</h1>
          <p>
            Akses layanan akademik, kelas, pembayaran, dan pelaporan melalui ruang kerja yang aman dan terhubung.
          </p>
        </div>

        <div class="trust-grid" aria-label="Keunggulan platform">
          <article>
            <span class="trust-grid__number">01</span>
            <strong>Data terpusat</strong>
            <p>Satu sumber informasi untuk mahasiswa, dosen, dan pengelola.</p>
          </article>
          <article>
            <span class="trust-grid__number">02</span>
            <strong>Akses sesuai peran</strong>
            <p>Layanan dan data ditampilkan berdasarkan kewenangan pengguna.</p>
          </article>
          <article>
            <span class="trust-grid__number">03</span>
            <strong>Aktivitas terlacak</strong>
            <p>Perubahan penting tercatat untuk akuntabilitas operasional.</p>
          </article>
        </div>
      </div>

      <div class="login-story__footer">
        <span>Status layanan</span>
        <strong><i aria-hidden="true" /> Semua sistem beroperasi normal</strong>
      </div>
    </section>

    <section class="login-panel" aria-labelledby="login-title">
      <div id="login-form" class="login-card">
        <div class="login-card__mobile-brand">
          <span class="brand-lockup__mark" aria-hidden="true">N</span>
          <strong>Nusa Campus</strong>
        </div>

        <div class="login-card__heading">
          <span class="eyebrow-text">Selamat datang kembali</span>
          <h2 id="login-title">Masuk ke akun Anda</h2>
          <p>Gunakan akun kampus yang telah terdaftar.</p>
        </div>

        <div v-if="localError || authError" class="alert alert-danger d-flex align-items-start gap-2" role="alert">
          <i class="uil uil-exclamation-triangle" aria-hidden="true" />
          <span>{{ localError || authError }}</span>
        </div>

        <form class="login-form" novalidate @submit.prevent="submitLogin">
          <div>
            <label class="form-label" for="email">Email kampus</label>
            <div class="input-shell">
              <i class="uil uil-envelope" aria-hidden="true" />
              <input
                id="email"
                v-model="email"
                class="form-control"
                type="email"
                inputmode="email"
                autocomplete="username"
                placeholder="nama@kampus.ac.id"
                required
              >
            </div>
          </div>

          <div>
            <div class="d-flex align-items-center justify-content-between gap-3">
              <label class="form-label" for="password">Kata sandi</label>
              <button class="forgot-link" type="button" @click="openReset">
                Lupa kata sandi?
              </button>
            </div>
            <div class="input-shell">
              <i class="uil uil-lock" aria-hidden="true" />
              <input
                id="password"
                v-model="password"
                class="form-control"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="Masukkan kata sandi"
                required
              >
              <button
                class="password-toggle"
                type="button"
                :aria-label="showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'"
                :aria-pressed="showPassword"
                @click="showPassword = !showPassword"
              >
                <i :class="showPassword ? 'uil uil-eye-slash' : 'uil uil-eye'" aria-hidden="true" />
              </button>
            </div>
          </div>

          <label class="form-check d-flex align-items-center gap-2">
            <input v-model="remember" class="form-check-input mt-0" type="checkbox">
            <span class="form-check-label">Ingat akun ini di perangkat pribadi</span>
          </label>

          <button class="btn btn-primary login-submit" type="submit" :disabled="pending">
            <span v-if="pending" class="spinner-border spinner-border-sm" aria-hidden="true" />
            <span>{{ pending ? 'Memeriksa akun…' : 'Masuk ke Nusa Campus' }}</span>
            <i v-if="!pending" class="uil uil-arrow-right" aria-hidden="true" />
          </button>
        </form>

        <form v-if="showReset" class="reset-panel" aria-labelledby="reset-title" @submit.prevent="submitReset">
          <div class="reset-panel__heading"><div><span class="eyebrow-text">Pemulihan akun</span><h3 id="reset-title">Atur ulang kata sandi</h3></div><button type="button" aria-label="Tutup formulir pemulihan" @click="showReset = false"><i class="uil uil-times" aria-hidden="true" /></button></div>
          <p>Masukkan email akun. Respons yang sama digunakan untuk seluruh alamat agar status akun tetap rahasia.</p>
          <div v-if="resetMessage" class="alert alert-success py-2" role="status">{{ resetMessage }}</div>
          <div v-if="resetError" class="alert alert-danger py-2" role="alert">{{ resetError }}</div>
          <label class="form-label" for="reset-email">Email akun</label>
          <div class="input-shell"><i class="uil uil-envelope" aria-hidden="true" /><input id="reset-email" v-model="resetEmail" class="form-control" type="email" autocomplete="email" required placeholder="nama@kampus.ac.id"></div>
          <button class="btn btn-outline-primary w-100 mt-3" type="submit" :disabled="resetPending"><span v-if="resetPending" class="spinner-border spinner-border-sm me-2" aria-hidden="true" />Kirim petunjuk pemulihan</button>
        </form>

        <div class="candidate-note">
          <span>Calon mahasiswa?</span>
          <NuxtLink to="/pmb/informasi">Lihat informasi PMB</NuxtLink>
          <span aria-hidden="true">·</span>
          <NuxtLink to="/pmb/daftar">Mulai daftar</NuxtLink>
        </div>

        <div v-if="config.public.demoMode" class="demo-note">
          <i class="uil uil-info-circle" aria-hidden="true" />
          <p><strong>Mode demonstrasi</strong><br>Email dan kata sandi di atas sudah diisi untuk melihat prototipe.</p>
        </div>

        <footer class="login-card__footer">
          <span>Butuh bantuan?</span>
          <a href="mailto:helpdesk@kampus.ac.id">helpdesk@kampus.ac.id</a>
          <span aria-hidden="true">•</span>
          <a href="tel:+62215550124">(021) 555-0124</a>
        </footer>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(480px, .92fr);
  background: #f6f8f5;
  color: #18362f;
}

.skip-link {
  position: fixed;
  z-index: 100;
  top: 1rem;
  left: 1rem;
  padding: .75rem 1rem;
  border-radius: .75rem;
  background: #fff;
  color: #173e34;
}

.login-story {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: clamp(2rem, 5vw, 4.5rem);
  color: #f5fbf6;
  background:
    linear-gradient(145deg, rgba(10, 45, 37, .98), rgba(20, 82, 65, .93)),
    radial-gradient(circle at top right, #3b846b, transparent 52%);
}

.login-story::after {
  content: '';
  position: absolute;
  z-index: -1;
  inset: 0;
  opacity: .08;
  background-image: linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: linear-gradient(to bottom, #000, transparent 88%);
}

.login-story__content { max-width: 760px; }

.login-story__glow {
  position: absolute;
  z-index: -1;
  border-radius: 50%;
  filter: blur(2px);
  opacity: .4;
  background: rgba(194, 231, 170, .24);
}

.login-story__glow--one { width: 28rem; height: 28rem; right: -12rem; top: -10rem; }
.login-story__glow--two { width: 19rem; height: 19rem; left: -8rem; bottom: 4rem; }

.brand-lockup {
  display: inline-flex;
  align-items: center;
  gap: .85rem;
  color: inherit;
  text-decoration: none;
}

.brand-lockup__mark {
  display: grid;
  place-items: center;
  width: 2.8rem;
  height: 2.8rem;
  border: 1px solid rgba(255,255,255,.44);
  border-radius: .9rem;
  color: #173e34;
  background: #d9f4c5;
  font-weight: 800;
  font-size: 1.35rem;
  box-shadow: 0 12px 30px rgba(4, 29, 23, .18);
}

.brand-lockup strong,
.brand-lockup small { display: block; }
.brand-lockup strong { font-size: 1.06rem; letter-spacing: -.01em; }
.brand-lockup small { margin-top: .1rem; color: rgba(255,255,255,.62); font-size: .72rem; }

.login-story__copy { margin-top: clamp(5rem, 12vh, 10rem); }

.eyebrow-pill {
  display: inline-flex;
  padding: .48rem .8rem;
  border: 1px solid rgba(221, 248, 204, .22);
  border-radius: 999px;
  color: #dff4d0;
  background: rgba(223, 244, 208, .08);
  font-size: .78rem;
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.login-story h1 {
  max-width: 710px;
  margin: 1.3rem 0 1.25rem;
  font-size: clamp(2.3rem, 4.2vw, 4.7rem);
  line-height: 1.02;
  letter-spacing: -.055em;
  text-wrap: balance;
}

.login-story__copy > p {
  max-width: 650px;
  margin: 0;
  color: rgba(244, 252, 246, .73);
  font-size: clamp(1rem, 1.5vw, 1.17rem);
  line-height: 1.75;
}

.trust-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-top: clamp(3rem, 7vh, 5.5rem);
}

.trust-grid article {
  padding-top: 1.15rem;
  border-top: 1px solid rgba(255,255,255,.16);
}

.trust-grid__number {
  display: block;
  margin-bottom: 1.2rem;
  color: #a8cf91;
  font-size: .72rem;
  font-weight: 800;
  letter-spacing: .12em;
}

.trust-grid strong { display: block; font-size: .9rem; }
.trust-grid p { margin: .45rem 0 0; color: rgba(255,255,255,.58); font-size: .78rem; line-height: 1.55; }

.login-story__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 3rem;
  padding-top: 1.25rem;
  border-top: 1px solid rgba(255,255,255,.11);
  color: rgba(255,255,255,.53);
  font-size: .76rem;
}

.login-story__footer strong { color: rgba(255,255,255,.78); font-weight: 600; }
.login-story__footer i { display: inline-block; width: .48rem; height: .48rem; margin-right: .5rem; border-radius: 50%; background: #9ce36e; box-shadow: 0 0 0 .28rem rgba(156,227,110,.12); }

.login-panel {
  display: grid;
  place-items: center;
  padding: clamp(2rem, 6vw, 7rem);
}

.login-card { width: min(100%, 460px); }
.login-card__mobile-brand { display: none; }

.login-card__heading { margin-bottom: 2rem; }
.eyebrow-text { color: #4e806f; font-size: .76rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
.login-card h2 { margin: .65rem 0 .55rem; color: #17352d; font-size: clamp(2rem, 3vw, 2.55rem); line-height: 1.1; letter-spacing: -.04em; }
.login-card__heading p { margin: 0; color: #72837e; }

.login-form { display: grid; gap: 1.2rem; }

.candidate-note { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; justify-content: center; margin-top: 1rem; color: #7a8984; font-size: .67rem; }
.candidate-note a { color: #27624f; font-weight: 800; text-decoration: none; }
.candidate-note a:hover { text-decoration: underline; }
.form-label { margin-bottom: .48rem; color: #304a43; font-size: .84rem; font-weight: 700; }

.input-shell { position: relative; }
.input-shell > i {
  position: absolute;
  z-index: 2;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  color: #6b817a;
  font-size: 1.14rem;
  pointer-events: none;
}

.input-shell .form-control {
  min-height: 3.35rem;
  padding: .75rem 3rem .75rem 2.9rem;
  border-color: #dce4df;
  border-radius: .85rem;
  color: #1d3831;
  background: #fff;
  box-shadow: 0 1px 1px rgba(20,55,46,.02);
}

.input-shell .form-control:focus {
  border-color: #4d8d76;
  box-shadow: 0 0 0 .22rem rgba(50, 120, 96, .13);
}

.password-toggle {
  position: absolute;
  z-index: 3;
  right: .65rem;
  top: 50%;
  display: grid;
  place-items: center;
  width: 2.15rem;
  height: 2.15rem;
  transform: translateY(-50%);
  border: 0;
  border-radius: .55rem;
  color: #647c74;
  background: transparent;
}

.password-toggle:hover,
.password-toggle:focus-visible { color: #173e34; background: #eef4f0; }

.forgot-link {
  padding: 0;
  border: 0;
  color: #397460;
  background: transparent;
  font-size: .78rem;
  font-weight: 700;
}

.reset-panel { margin-top: 1.1rem; padding: 1rem; border: 1px solid #d9e5df; border-radius: .9rem; background: #f7faf8; }
.reset-panel__heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.reset-panel__heading h3 { margin: .2rem 0 0; color: #24483b; font-size: 1rem; }
.reset-panel__heading button { display: grid; place-items: center; width: 2rem; height: 2rem; border: 0; border-radius: .55rem; color: #60766e; background: #e9f0ec; }
.reset-panel > p { margin: .65rem 0 .9rem; color: #73847e; font-size: .72rem; line-height: 1.5; }
.reset-panel .alert { font-size: .72rem; }

.form-check-label { color: #5e716b; font-size: .82rem; }
.form-check-input:checked { border-color: #2f6f5a; background-color: #2f6f5a; }

.login-submit {
  min-height: 3.4rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .75rem;
  margin-top: .25rem;
  border-color: #1c5444;
  border-radius: .85rem;
  background: #1c5444;
  font-weight: 700;
  box-shadow: 0 12px 28px rgba(24,76,60,.16);
}

.login-submit:hover,
.login-submit:focus-visible { border-color: #123f32; background: #123f32; }
.login-submit i { margin-left: auto; font-size: 1.1rem; }

.demo-note {
  display: flex;
  gap: .75rem;
  margin-top: 1.4rem;
  padding: .9rem 1rem;
  border: 1px solid #dce8d7;
  border-radius: .8rem;
  color: #526960;
  background: #f2f7ef;
  font-size: .75rem;
}

.demo-note i { color: #4b7f6b; font-size: 1rem; }
.demo-note p { margin: 0; line-height: 1.45; }

.login-card__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: .45rem;
  margin-top: 2rem;
  padding-top: 1.35rem;
  border-top: 1px solid #e2e8e4;
  color: #81908b;
  font-size: .74rem;
}

.login-card__footer a { color: #397460; font-weight: 700; text-decoration: none; }

@media (max-width: 1050px) {
  .login-page { grid-template-columns: minmax(0, .9fr) minmax(430px, 1fr); }
  .trust-grid { grid-template-columns: 1fr; gap: .65rem; }
  .trust-grid article { display: grid; grid-template-columns: 2rem 1fr; column-gap: .5rem; }
  .trust-grid__number { grid-row: 1 / 3; margin: .15rem 0 0; }
  .trust-grid p { margin-top: .2rem; }
}

@media (max-width: 820px) {
  .login-page { display: block; background: #f7f9f6; }
  .login-story { display: none; }
  .login-panel { min-height: 100vh; padding: 2rem 1.25rem; }
  .login-card__mobile-brand { display: flex; align-items: center; gap: .75rem; margin-bottom: 4rem; }
  .login-card__mobile-brand .brand-lockup__mark { color: #173e34; border-color: #cbdacf; }
  .login-card__mobile-brand strong { color: #17352d; }
}

@media (prefers-reduced-motion: reduce) {
  .spinner-border { animation: none; }
}
</style>
