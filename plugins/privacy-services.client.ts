const appendScript = (id: string, src: string, inline?: string) => {
  if (document.getElementById(id)) return
  const script = document.createElement('script')
  script.id = id
  script.async = true
  if (src) script.src = src
  if (inline) script.textContent = inline
  document.head.appendChild(script)
}

// Only an informational, form-free page may load optional analytics.
const publicAnalyticsRoutes = new Set(['/pmb/informasi'])

const removeScript = (id: string) => document.getElementById(id)?.remove()

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const route = useRoute()
  const { preferences } = usePrivacyConsent()

  watchEffect(() => {
    if (!preferences.value.experience || !config.public.googleFontsEnabled || document.getElementById('campus-google-font')) return
    const link = document.createElement('link')
    link.id = 'campus-google-font'
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'
    document.head.appendChild(link)
  })

  watchEffect(() => {
    const routeIsAllowed = config.public.analyticsPrivateEnabled || publicAnalyticsRoutes.has(route.path)
    const allowed = config.public.analyticsEnabled && preferences.value.analytics && routeIsAllowed

    if (!allowed) {
      if (config.public.googleAnalyticsId) (window as any)[`ga-disable-${config.public.googleAnalyticsId}`] = true
      if (typeof (window as any).clarity === 'function') {
        ;(window as any).clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' })
        ;(window as any).clarity('stop')
      }
      removeScript('campus-gtm')
      removeScript('campus-ga')
      removeScript('campus-ga-config')
      removeScript('campus-clarity')
      return
    }

    sessionStorage.setItem('campus-public-analytics-active', '1')
    if (config.public.googleAnalyticsId) (window as any)[`ga-disable-${config.public.googleAnalyticsId}`] = false

    if (config.public.googleTagManagerId) {
      const id = encodeURIComponent(config.public.googleTagManagerId)
      ;(window as any).dataLayer = (window as any).dataLayer || []
      ;(window as any).dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' })
      appendScript('campus-gtm', `https://www.googletagmanager.com/gtm.js?id=${id}`)
    } else if (config.public.googleAnalyticsId) {
      const id = encodeURIComponent(config.public.googleAnalyticsId)
      appendScript('campus-ga', `https://www.googletagmanager.com/gtag/js?id=${id}`)
      appendScript('campus-ga-config', '', `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config','${id}',{anonymize_ip:true,allow_google_signals:false});`)
    }

    if (config.public.microsoftClarityId) {
      const clarityId = JSON.stringify(config.public.microsoftClarityId)
      appendScript('campus-clarity', '', `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,'clarity','script',${clarityId});window.clarity('consentv2',{ad_Storage:'denied',analytics_Storage:'granted'});`)
    }
  })
})
