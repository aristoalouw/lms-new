<script setup lang="ts">
definePageMeta({
  layout: 'auth',
  middleware: 'guest',
})

useHead({ title: 'Masuk' })

const config = useRuntimeConfig()
const route = useRoute()
const { enabled } = useFeatureFlags()
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
const currentYear = new Date().getFullYear()
const appName = computed(() => String(config.public.appName || 'LMS STT Saint Paul').trim())
const appInitial = computed(() => appName.value.charAt(0).toUpperCase() || 'S')
const supportEmail = computed(() => String(config.public.supportEmail || '').trim())
const supportPhone = computed(() => String(config.public.supportPhone || '').trim())
const supportPhoneHref = computed(() => {
  const normalized = supportPhone.value.replace(/[\s().-]/g, '')
  return /^\+?\d{6,20}$/.test(normalized) ? `tel:${normalized}` : ''
})
let resetIdempotencyKey = ''
const {
  available: passwordResetAvailable,
  deliveryLabel: passwordResetDeliveryLabel,
  requestPasswordReset,
} = usePasswordReset()

const redirectAfterLogin = computed(() => {
  const value = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  return value.startsWith('/') && !value.startsWith('//') ? value : '/'
})

const submitLogin = async () => {
  localError.value = ''

  if (!email.value.trim() || !password.value) {
    localError.value = 'Masukkan email kampus dan kata sandi Anda.'
    return
  }

  try {
    await login(email.value.trim(), password.value, remember.value)
    await navigateTo(redirectAfterLogin.value)
  } catch {
    localError.value = authError.value || 'Login gagal. Periksa kembali akun Anda.'
  }
}

const openReset = () => {
  if (!passwordResetAvailable.value) return
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
    resetMessage.value = await requestPasswordReset(resetEmail.value, resetIdempotencyKey)
  } catch (error) {
    const candidate = error as { response?: { data?: { statusMessage?: string; message?: string } } }
    resetError.value = candidate.response?.data?.statusMessage || candidate.response?.data?.message || 'Permintaan belum dapat diproses. Coba kembali nanti.'
  } finally {
    resetPending.value = false
  }
}

watch(resetEmail, () => { resetIdempotencyKey = '' })

onMounted(() => {
  if (config.public.demoMode) return
  try {
    const rememberedEmail = window.localStorage.getItem('campus.rememberedEmail')?.trim()
    if (rememberedEmail) {
      email.value = rememberedEmail
      remember.value = true
    }
  } catch {
    // Ignore storage access errors in restricted browsers.
  }
})
</script>

<template>
  <main class="login-page">
    <a class="visually-hidden-focusable skip-link" href="#login-form">Lewati ke formulir masuk</a>

    <section class="login-brand" aria-labelledby="campus-title">
      <div class="login-brand__top">
        <NuxtLink class="brand-lockup" to="/" :aria-label="`${appName}, beranda`">
          <span class="brand-lockup__mark" aria-hidden="true">{{ appInitial }}</span>
          <strong>{{ appName }}</strong>
        </NuxtLink>
      </div>

      <div class="login-brand__center">
        <div class="login-brand__rule" aria-hidden="true" />
        <h1 id="campus-title">Sekolah Tinggi Teologi Saint Paul Bandung</h1>
        <p>Sistem Informasi Akademik</p>
      </div>

      <div class="login-brand__footer">
        <span>© {{ currentYear }} STT Saint Paul Bandung</span>
      </div>
    </section>

    <section class="login-panel" aria-labelledby="login-title">
      <div id="login-form" class="login-card">
        <div class="login-card__mobile-brand">
          <span class="brand-lockup__mark" aria-hidden="true">{{ appInitial }}</span>
          <strong>{{ appName }}</strong>
        </div>

        <div class="login-card__heading">
          <h2 id="login-title">Masuk</h2>
          <p>Gunakan email kampus dan kata sandi Anda.</p>
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
                placeholder="nama@sttsaintpaul.ac.id"
                required
              >
            </div>
          </div>

          <div>
            <div class="d-flex align-items-center justify-content-between gap-3">
              <label class="form-label" for="password">Kata sandi</label>
              <button class="forgot-link" type="button" :disabled="!passwordResetAvailable" @click="openReset">
                {{ passwordResetAvailable ? 'Lupa kata sandi?' : 'Pemulihan email belum tersedia' }}
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
            <span>{{ pending ? 'Memeriksa akun…' : 'Masuk' }}</span>
            <i v-if="!pending" class="uil uil-arrow-right" aria-hidden="true" />
          </button>
        </form>

        <form v-if="showReset" class="reset-panel" aria-labelledby="reset-title" @submit.prevent="submitReset">
          <div class="reset-panel__heading">
            <div>
              <h3 id="reset-title">Atur ulang kata sandi</h3>
            </div>
            <button type="button" aria-label="Tutup formulir pemulihan" @click="showReset = false">
              <i class="uil uil-times" aria-hidden="true" />
            </button>
          </div>
          <p>Masukkan email kampus Anda. Tautan pengaturan ulang kata sandi akan dikirim melalui {{ passwordResetDeliveryLabel }}.</p>
          <div v-if="resetMessage" class="alert alert-success py-2" role="status">{{ resetMessage }}</div>
          <div v-if="resetError" class="alert alert-danger py-2" role="alert">{{ resetError }}</div>
          <label class="form-label" for="reset-email">Email akun</label>
          <div class="input-shell">
            <i class="uil uil-envelope" aria-hidden="true" />
            <input id="reset-email" v-model="resetEmail" class="form-control" type="email" autocomplete="email" required placeholder="nama@sttsaintpaul.ac.id">
          </div>
          <button class="btn btn-outline-primary w-100 mt-3" type="submit" :disabled="resetPending">
            <span v-if="resetPending" class="spinner-border spinner-border-sm me-2" aria-hidden="true" />Kirim petunjuk pemulihan
          </button>
        </form>

        <div v-if="enabled('admissions')" class="candidate-note">
          <span>Calon mahasiswa?</span>
          <NuxtLink to="/pmb/informasi">Informasi PMB</NuxtLink>
          <span aria-hidden="true">·</span>
          <NuxtLink to="/pmb/daftar">Daftar</NuxtLink>
        </div>

        <div v-if="config.public.demoMode" class="demo-note">
          <i class="uil uil-info-circle" aria-hidden="true" />
          <p><strong>Mode demonstrasi</strong><br>Email dan kata sandi di atas sudah diisi untuk pengujian.</p>
        </div>

        <footer v-if="supportEmail || supportPhoneHref" class="login-card__footer">
          <span>Bantuan:</span>
          <a v-if="supportEmail" :href="`mailto:${supportEmail}`">{{ supportEmail }}</a>
          <span v-if="supportEmail && supportPhoneHref" aria-hidden="true">•</span>
          <a v-if="supportPhoneHref" :href="supportPhoneHref">{{ supportPhone }}</a>
        </footer>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(460px, .95fr);
  background: #faf6ef;
  color: #1e1e1e;
}

.skip-link {
  position: fixed;
  z-index: 100;
  top: 1rem;
  left: 1rem;
  padding: .75rem 1rem;
  border-radius: 6px;
  background: #fff;
  color: #593660;
}

.login-brand {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: clamp(2rem, 5vw, 4.5rem);
  color: #ffffff;
  background: #593660;
  border-right: 4px solid #fbf0de;
}

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
  width: 2.65rem;
  height: 2.65rem;
  border: 1px solid rgba(255, 255, 255, .36);
  border-radius: 6px;
  color: #593660;
  background: #fbf0de;
  font-weight: 800;
  font-size: 1.25rem;
}

.brand-lockup strong {
  font-size: 1.02rem;
  letter-spacing: -.01em;
}

.login-brand__center {
  max-width: 520px;
}

.login-brand__rule {
  width: 3rem;
  height: 2px;
  margin-bottom: 1.5rem;
  background: #fbf0de;
  opacity: .7;
}

.login-brand__center h1 {
  margin: 0;
  font-size: clamp(1.85rem, 3.1vw, 2.85rem);
  font-weight: 700;
  line-height: 1.18;
  letter-spacing: -.03em;
  text-wrap: balance;
}

.login-brand__center p {
  margin: .9rem 0 0;
  color: rgba(251, 240, 222, .78);
  font-size: .98rem;
  font-weight: 500;
}

.login-brand__footer {
  padding-top: 1.25rem;
  border-top: 1px solid rgba(255, 255, 255, .14);
  color: rgba(251, 240, 222, .72);
  font-size: .78rem;
}

.login-panel {
  display: grid;
  place-items: center;
  padding: clamp(2rem, 6vw, 7rem);
}

.login-card { width: min(100%, 440px); }
.login-card__mobile-brand { display: none; }

.login-card__heading { margin-bottom: 1.85rem; }
.login-card h2 {
  margin: 0 0 .45rem;
  color: #1e1e1e;
  font-size: clamp(1.85rem, 2.8vw, 2.25rem);
  line-height: 1.15;
  letter-spacing: -.03em;
}
.login-card__heading p { margin: 0; color: #6c6865; font-size: .92rem; }

.login-form { display: grid; gap: 1.2rem; }

.candidate-note {
  display: flex;
  flex-wrap: wrap;
  gap: .4rem;
  align-items: center;
  justify-content: center;
  margin-top: 1.15rem;
  color: #6c6865;
  font-size: .74rem;
}
.candidate-note a { color: #593660; font-weight: 700; text-decoration: none; }
.candidate-note a:hover { text-decoration: underline; }
.form-label { margin-bottom: .48rem; color: #1e1e1e; font-size: .84rem; font-weight: 700; }

.input-shell { position: relative; }
.input-shell > i {
  position: absolute;
  z-index: 2;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  color: #6c6865;
  font-size: 1.14rem;
  pointer-events: none;
}

.input-shell .form-control {
  min-height: 3.35rem;
  padding: .75rem 3rem .75rem 2.9rem;
  border-color: #ada098;
  border-radius: 6px;
  color: #1e1e1e;
  background: #fff;
  box-shadow: 0 1px 1px rgba(20, 55, 46, .02);
}

.input-shell .form-control:focus {
  border-color: #593660;
  box-shadow: 0 0 0 .2rem rgba(89, 54, 96, .16);
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
  color: #6c6865;
  background: transparent;
}

.password-toggle:hover,
.password-toggle:focus-visible { color: #593660; background: #efe9f2; }

.forgot-link {
  padding: 0;
  border: 0;
  color: #593660;
  background: transparent;
  font-size: .78rem;
  font-weight: 700;
}

.reset-panel { margin-top: 1.1rem; padding: 1rem; border: 1px solid #d9e5df; border-radius: 6px; background: #f7faf8; }
.reset-panel__heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.reset-panel__heading h3 { margin: 0; color: #593660; font-size: 1rem; }
.reset-panel__heading button { display: grid; place-items: center; width: 2rem; height: 2rem; border: 0; border-radius: .55rem; color: #593660; background: #efe9f2; }
.reset-panel > p { margin: .65rem 0 .9rem; color: #6c6865; font-size: .74rem; line-height: 1.5; }
.reset-panel .alert { font-size: .74rem; }

.form-check-label { color: #4e5462; font-size: .82rem; }
.form-check-input:checked { border-color: #593660; background-color: #593660; }

.login-submit {
  min-height: 3.4rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .75rem;
  margin-top: .25rem;
  border-color: #593660;
  border-radius: 999px;
  background: #593660;
  font-weight: 700;
  box-shadow: none;
}

.login-submit:hover,
.login-submit:focus-visible { border-color: #3e2344; background: #3e2344; }
.login-submit i { margin-left: auto; font-size: 1.1rem; }

.demo-note {
  display: flex;
  gap: .75rem;
  margin-top: 1.4rem;
  padding: .9rem 1rem;
  border: 1px solid #e6dfd6;
  border-radius: 8px;
  color: #4e5462;
  background: #fbf0de;
  font-size: .75rem;
}

.demo-note i { color: #593660; font-size: 1rem; }
.demo-note p { margin: 0; line-height: 1.45; }

.login-card__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: .45rem;
  margin-top: 2rem;
  padding-top: 1.35rem;
  border-top: 1px solid #e6dfd6;
  color: #6c6865;
  font-size: .74rem;
}

.login-card__footer a { color: #593660; font-weight: 700; text-decoration: none; }

@media (max-width: 1050px) {
  .login-page { grid-template-columns: minmax(0, .9fr) minmax(430px, 1fr); }
}

@media (max-width: 820px) {
  .login-page { display: block; background: #faf6ef; }
  .login-brand { display: none; }
  .login-panel { min-height: 100vh; padding: 2rem 1.25rem; }
  .login-card__mobile-brand { display: flex; align-items: center; gap: .75rem; margin-bottom: 3rem; }
  .login-card__mobile-brand .brand-lockup__mark { color: #593660; border-color: #ada098; }
  .login-card__mobile-brand strong { color: #1e1e1e; }
}

@media (prefers-reduced-motion: reduce) {
  .spinner-border { animation: none; }
}
</style>
