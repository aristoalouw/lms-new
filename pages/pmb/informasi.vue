<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Penerimaan Mahasiswa Baru' })

const programs = [
  { name: 'S1 Manajemen', faculty: 'Fakultas Ekonomi & Bisnis', mode: 'Reguler · Hybrid', icon: 'uil-chart-line' },
  { name: 'S1 Akuntansi', faculty: 'Fakultas Ekonomi & Bisnis', mode: 'Reguler · Hybrid', icon: 'uil-calculator-alt' },
  { name: 'S1 Informatika', faculty: 'Fakultas Teknologi', mode: 'Reguler · Hybrid', icon: 'uil-brackets-curly' },
  { name: 'S1 Sistem Informasi', faculty: 'Fakultas Teknologi', mode: 'Reguler · Hybrid', icon: 'uil-database' },
  { name: 'S1 Ilmu Komunikasi', faculty: 'Fakultas Sosial', mode: 'Reguler · Hybrid', icon: 'uil-comments' },
]

const steps = [
  { number: '01', title: 'Buat akun', detail: 'Gunakan email aktif untuk menerima informasi seleksi.' },
  { number: '02', title: 'Lengkapi data', detail: 'Pilih program studi dan unggah dokumen persyaratan.' },
  { number: '03', title: 'Verifikasi', detail: 'Panitia memeriksa pembayaran dan kelengkapan berkas.' },
  { number: '04', title: 'Ikuti seleksi', detail: 'Jadwal serta hasil seleksi tersedia di portal pendaftar.' },
]

const faqs = [
  { question: 'Apakah pendaftaran dapat dilakukan sepenuhnya daring?', answer: 'Ya. Pengisian formulir, unggah dokumen, pembayaran, jadwal seleksi, dan pengumuman tersedia melalui portal pendaftar.' },
  { question: 'Jalur apa saja yang tersedia?', answer: 'Gelombang aktif menerima jalur Reguler, KIP Kuliah, Pindahan, dan RPL. Persyaratan tiap jalur ditampilkan setelah Anda memilih jalur.' },
  { question: 'Bagaimana saya mengetahui status berkas?', answer: 'Status verifikasi dan catatan panitia tampil pada linimasa portal serta dikirim ke email terdaftar.' },
]
</script>

<template>
  <main class="admission-public">
    <nav class="admission-nav" aria-label="Navigasi penerimaan">
      <NuxtLink to="/pmb/informasi" class="public-brand" aria-label="Nusa Campus PMB">
        <span class="public-brand__mark">N</span>
        <span><strong>Nusa Campus</strong><small>Penerimaan mahasiswa baru</small></span>
      </NuxtLink>
      <div class="admission-nav__links d-none d-md-flex">
        <a href="#program">Program studi</a>
        <a href="#alur">Alur daftar</a>
        <a href="#biaya">Biaya</a>
        <a href="#faq">FAQ</a>
      </div>
      <div class="admission-nav__actions">
        <NuxtLink class="btn btn-light d-none d-sm-inline-flex" to="/login">Masuk portal</NuxtLink>
        <NuxtLink class="btn btn-primary" to="/pmb/daftar">Daftar sekarang</NuxtLink>
      </div>
    </nav>

    <section class="admission-hero">
      <div class="admission-hero__copy">
        <span class="public-eyebrow"><i class="uil uil-graduation-cap" /> Pendaftaran 2026/2027 dibuka</span>
        <h1>Mulai perjalanan kuliahmu dengan langkah yang jelas.</h1>
        <p>Pilih program studi, lengkapi berkas, dan pantau seluruh proses penerimaan melalui satu portal yang aman.</p>
        <div class="admission-hero__actions">
          <NuxtLink class="btn btn-primary btn-lg" to="/pmb/daftar">Mulai pendaftaran <i class="uil uil-arrow-right" /></NuxtLink>
          <a class="btn btn-outline-primary btn-lg" href="#program">Lihat program studi</a>
        </div>
        <div class="admission-trust">
          <span><i class="uil uil-shield-check" /> Data terlindungi</span>
          <span><i class="uil uil-clock" /> Proses terpantau</span>
          <span><i class="uil uil-envelope-check" /> Notifikasi email</span>
        </div>
      </div>

      <div class="admission-hero__panel" aria-label="Ringkasan gelombang aktif">
        <div class="hero-panel__head">
          <span class="hero-panel__icon"><i class="uil uil-calendar-alt" /></span>
          <div><small>Gelombang aktif</small><strong>Gelombang 3</strong></div>
          <StatusBadge status="active" label="Dibuka" />
        </div>
        <div class="hero-panel__dates">
          <div><small>Mulai</small><strong>1 Juli 2026</strong></div>
          <i class="uil uil-arrow-right" />
          <div><small>Berakhir</small><strong>31 Agustus 2026</strong></div>
        </div>
        <div class="hero-panel__progress">
          <span><b>158</b> pendaftar saat ini</span><span>Kuota tersisa 242</span>
          <div class="progress" role="progressbar" aria-label="Kuota terisi" aria-valuenow="39" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width: 39%" /></div>
        </div>
        <div class="hero-panel__note">
          <i class="uil uil-info-circle" />
          <span><strong>Seleksi berikutnya 8 Agustus</strong><small>Lengkapi berkas paling lambat 5 Agustus 2026.</small></span>
        </div>
      </div>
    </section>

    <section class="public-metrics" aria-label="Ringkasan kampus">
      <div><strong>5</strong><span>Program studi</span></div>
      <div><strong>2.000+</strong><span>Komunitas mahasiswa</span></div>
      <div><strong>Hybrid</strong><span>Model perkuliahan</span></div>
      <div><strong>Terintegrasi</strong><span>Layanan akademik</span></div>
    </section>

    <section id="program" class="public-section">
      <header class="public-section__header">
        <div><span class="section-kicker">Temukan bidangmu</span><h2>Program studi pilihan</h2><p>Kurikulum terapan untuk kebutuhan profesi dan perkembangan industri.</p></div>
        <a href="#biaya" class="text-link">Lihat rincian biaya <i class="uil uil-arrow-right" /></a>
      </header>
      <div class="program-grid">
        <article v-for="program in programs" :key="program.name" class="program-card">
          <span class="program-card__icon"><i class="uil" :class="program.icon" /></span>
          <div><small>{{ program.faculty }}</small><h3>{{ program.name }}</h3><p>{{ program.mode }}</p></div>
          <NuxtLink :to="`/pmb/daftar?program=${encodeURIComponent(program.name)}`" :aria-label="`Daftar ${program.name}`"><i class="uil uil-arrow-up-right" /></NuxtLink>
        </article>
      </div>
    </section>

    <section id="alur" class="public-section public-section--tinted">
      <header class="public-section__header public-section__header--center">
        <div><span class="section-kicker">Sederhana dan transparan</span><h2>Empat langkah menuju kampus</h2><p>Status setiap tahap dapat dipantau dari portal pendaftar.</p></div>
      </header>
      <div class="admission-steps">
        <article v-for="step in steps" :key="step.number">
          <span>{{ step.number }}</span><h3>{{ step.title }}</h3><p>{{ step.detail }}</p>
        </article>
      </div>
    </section>

    <section id="biaya" class="public-section">
      <div class="fee-layout">
        <div class="fee-layout__copy">
          <span class="section-kicker">Biaya yang mudah dipahami</span>
          <h2>Rencanakan pendidikan tanpa kejutan.</h2>
          <p>Nominal akhir mengikuti program studi dan jalur masuk. Seluruh komponen tagihan tampil sebelum pembayaran.</p>
          <ul>
            <li><i class="uil uil-check-circle" /> Cicilan biaya pendidikan tersedia</li>
            <li><i class="uil uil-check-circle" /> Dukungan beasiswa prestasi dan KIP Kuliah</li>
            <li><i class="uil uil-check-circle" /> Pembayaran daring dengan status real-time</li>
          </ul>
          <NuxtLink class="btn btn-outline-primary" to="/pmb/daftar">Cek biaya sesuai pilihan</NuxtLink>
        </div>
        <div class="fee-card">
          <div><small>Biaya formulir</small><strong>Rp 500.000</strong><span>Satu kali pembayaran</span></div>
          <hr>
          <div class="fee-card__row"><span>Uang kuliah mulai</span><strong>Rp 7,5 jt <small>/ semester</small></strong></div>
          <div class="fee-card__row"><span>Pilihan cicilan</span><strong>Hingga 3×</strong></div>
          <div class="fee-card__row"><span>Jalur beasiswa</span><strong>Tersedia</strong></div>
          <p><i class="uil uil-lock" /> Pembayaran diproses melalui kanal resmi yang terverifikasi.</p>
        </div>
      </div>
    </section>

    <section id="faq" class="public-section public-section--faq">
      <header class="public-section__header"><div><span class="section-kicker">Informasi pendaftaran</span><h2>Pertanyaan yang sering diajukan</h2></div></header>
      <div class="accordion accordion-flush public-faq" id="admission-faq">
        <article v-for="(faq, index) in faqs" :key="faq.question" class="accordion-item">
          <h3 class="accordion-header"><button class="accordion-button" :class="{ collapsed: index !== 0 }" type="button" data-bs-toggle="collapse" :data-bs-target="`#faq-${index}`" :aria-expanded="index === 0">{{ faq.question }}</button></h3>
          <div :id="`faq-${index}`" class="accordion-collapse collapse" :class="{ show: index === 0 }" data-bs-parent="#admission-faq"><div class="accordion-body">{{ faq.answer }}</div></div>
        </article>
      </div>
    </section>

    <section class="public-cta">
      <div><span>Gelombang 3 berakhir 31 Agustus 2026</span><h2>Siap mengambil langkah pertama?</h2><p>Buat akun pendaftar dan simpan progres formulir kapan saja.</p></div>
      <NuxtLink class="btn btn-light btn-lg" to="/pmb/daftar">Daftar sekarang <i class="uil uil-arrow-right" /></NuxtLink>
    </section>

    <footer class="public-footer">
      <div class="public-brand"><span class="public-brand__mark">N</span><span><strong>Nusa Campus</strong><small>Sistem informasi terpadu</small></span></div>
      <p>© 2026 Nusa Campus · Informasi penerimaan dapat berubah sesuai kebijakan kampus.</p>
      <div><a href="#">Kebijakan privasi</a><a href="#">Kontak PMB</a></div>
    </footer>
  </main>
</template>

<style scoped>
.admission-public { min-height: 100vh; color: #19332b; background: #fbfcf9; }
.admission-nav { position: relative; z-index: 2; display: flex; max-width: 1240px; height: 78px; margin: auto; padding: 0 24px; align-items: center; justify-content: space-between; gap: 24px; }
.public-brand { display: inline-flex; align-items: center; gap: 10px; color: inherit; text-decoration: none; }
.public-brand__mark { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 12px 12px 12px 4px; color: #fff; background: linear-gradient(145deg,#d39b2a,#e6b74f); font: 700 1.3rem Georgia,serif; }
.public-brand > span:last-child { display: flex; flex-direction: column; line-height: 1.2; }
.public-brand strong { font-size: .92rem; font-weight: 800; }.public-brand small { margin-top: 2px; color: #788680; font-size: .6rem; }
.admission-nav__links { gap: 25px; }.admission-nav__links a,.public-footer a { color: #526760; font-size: .7rem; font-weight: 700; text-decoration: none; }.admission-nav__links a:hover { color: #19483b; }
.admission-nav__actions { display: flex; gap: 8px; }.admission-nav .btn { white-space: nowrap; }
.admission-hero { position: relative; display: grid; max-width: 1240px; min-height: 590px; margin: auto; padding: 80px 24px 95px; grid-template-columns: minmax(0,1.08fr) minmax(360px,.72fr); gap: clamp(45px,7vw,100px); align-items: center; }
.admission-hero::before { position: absolute; z-index: 0; top: -80px; right: -11vw; width: 560px; height: 560px; border-radius: 50%; background: radial-gradient(circle,rgba(43,103,83,.1),transparent 68%); content: ''; pointer-events: none; }
.admission-hero__copy,.admission-hero__panel { position: relative; z-index: 1; }
.public-eyebrow { display: inline-flex; gap: 7px; align-items: center; padding: 7px 10px; border: 1px solid #dce8e2; border-radius: 30px; color: #376e5b; background: #eff7f2; font-size: .65rem; font-weight: 800; }
.admission-hero h1 { max-width: 700px; margin: 20px 0 18px; color: #102e25; font-size: clamp(2.7rem,5.3vw,4.75rem); font-weight: 800; letter-spacing: -.065em; line-height: 1.02; }
.admission-hero__copy > p { max-width: 620px; color: #657870; font-size: .96rem; line-height: 1.75; }
.admission-hero__actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }.admission-hero__actions .btn { min-height: 52px; }
.admission-trust { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 25px; color: #73827c; font-size: .65rem; font-weight: 700; }.admission-trust i { color: #36735e; }
.admission-hero__panel { padding: 24px; border: 1px solid rgba(255,255,255,.25); border-radius: 24px; color: #fff; background: linear-gradient(150deg,#19483b,#0b2b22); box-shadow: 0 30px 65px rgba(17,54,44,.2); }
.hero-panel__head { display: flex; gap: 11px; align-items: center; padding-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,.11); }.hero-panel__icon { display: grid; width: 40px; height: 40px; place-items: center; border-radius: 12px; color: #f0c96c; background: rgba(211,155,42,.16); font-size: 1.15rem; }.hero-panel__head > div { display: flex; flex: 1; flex-direction: column; }.hero-panel__head small,.hero-panel__dates small { color: rgba(255,255,255,.5); font-size: .61rem; }.hero-panel__head strong { margin-top: 3px; font-size: .86rem; }
.hero-panel__dates { display: grid; grid-template-columns: 1fr auto 1fr; gap: 14px; align-items: center; padding: 23px 0; }.hero-panel__dates > div { display: flex; flex-direction: column; }.hero-panel__dates > div:last-child { text-align: right; }.hero-panel__dates strong { margin-top: 4px; font-size: .79rem; }
.hero-panel__progress { padding: 15px; border-radius: 13px; background: rgba(255,255,255,.065); }.hero-panel__progress > span { display: inline-block; margin-bottom: 10px; color: rgba(255,255,255,.55); font-size: .61rem; }.hero-panel__progress > span:nth-child(2) { float: right; }.hero-panel__progress b { color: #fff; }.hero-panel__progress .progress { height: 5px; background: rgba(255,255,255,.12); }.hero-panel__progress .progress-bar { background: #e3b958; }
.hero-panel__note { display: flex; gap: 10px; align-items: flex-start; margin-top: 15px; padding: 13px; border: 1px solid rgba(227,185,88,.18); border-radius: 12px; color: #f3cd76; background: rgba(211,155,42,.09); }.hero-panel__note > span { display: flex; flex-direction: column; }.hero-panel__note strong { color: #f7e2ad; font-size: .67rem; }.hero-panel__note small { margin-top: 3px; color: rgba(255,255,255,.5); font-size: .57rem; }
.public-metrics { display: grid; max-width: 1192px; margin: 0 auto 30px; padding: 27px 34px; grid-template-columns: repeat(4,1fr); border: 1px solid #e2e9e5; border-radius: 19px; background: #fff; box-shadow: 0 14px 34px rgba(23,55,45,.06); }.public-metrics > div { display: flex; align-items: center; flex-direction: column; border-right: 1px solid #e8edea; }.public-metrics > div:last-child { border: 0; }.public-metrics strong { color: #1a4d3e; font-size: 1.35rem; font-weight: 800; letter-spacing: -.04em; }.public-metrics span { margin-top: 3px; color: #80908a; font-size: .63rem; }
.public-section { max-width: 1240px; margin: auto; padding: 95px 24px; }.public-section--tinted { max-width: none; padding-inline: max(24px,calc((100vw - 1192px)/2)); background: #eef4f0; }.public-section__header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 34px; }.public-section__header--center { justify-content: center; text-align: center; }.public-section h2 { margin: 0; color: #173a2f; font-size: clamp(1.65rem,3vw,2.4rem); font-weight: 800; letter-spacing: -.045em; }.public-section__header p { margin: 8px 0 0; color: #75857f; font-size: .78rem; }.text-link { color: #2a6954; font-size: .7rem; font-weight: 800; text-decoration: none; }
.program-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 13px; }.program-card { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 14px; align-items: center; padding: 20px; border: 1px solid #e0e8e3; border-radius: 16px; background: #fff; transition: transform .16s ease,box-shadow .16s ease; }.program-card:hover { transform: translateY(-3px); box-shadow: 0 15px 32px rgba(23,55,45,.08); }.program-card__icon { display: grid; width: 43px; height: 43px; place-items: center; border-radius: 13px; color: #2e6e58; background: #edf6f1; font-size: 1.2rem; }.program-card small { color: #8b9893; font-size: .57rem; }.program-card h3 { margin: 3px 0; font-size: .82rem; font-weight: 800; }.program-card p { margin: 0; color: #6f817a; font-size: .62rem; }.program-card > a { display: grid; width: 32px; height: 32px; place-items: center; border: 1px solid #dfe7e2; border-radius: 9px; color: #386f5d; text-decoration: none; }
.admission-steps { display: grid; grid-template-columns: repeat(4,1fr); gap: 0; counter-reset: steps; }.admission-steps article { position: relative; padding: 20px 30px 18px 0; }.admission-steps article:not(:last-child)::after { position: absolute; top: 35px; right: 12px; left: 55px; height: 1px; background: #cadbd2; content: ''; }.admission-steps span { position: relative; z-index: 1; display: grid; width: 38px; height: 38px; place-items: center; border: 5px solid #eef4f0; border-radius: 50%; color: #fff; background: #2e6c57; box-sizing: content-box; font-size: .58rem; font-weight: 800; }.admission-steps h3 { margin: 15px 0 6px; font-size: .8rem; font-weight: 800; }.admission-steps p { margin: 0; color: #73847d; font-size: .67rem; line-height: 1.6; }
.fee-layout { display: grid; grid-template-columns: 1fr minmax(360px,.7fr); gap: 80px; align-items: center; }.fee-layout__copy h2 { max-width: 570px; }.fee-layout__copy > p { max-width: 620px; margin: 15px 0 22px; color: #70827a; line-height: 1.7; }.fee-layout__copy ul { display: grid; gap: 10px; margin: 0 0 25px; padding: 0; list-style: none; color: #4b6259; font-size: .72rem; }.fee-layout__copy li i { margin-right: 7px; color: #2b785b; }
.fee-card { padding: 27px; border: 1px solid #dfe8e2; border-radius: 20px; background: #fff; box-shadow: 0 20px 48px rgba(20,55,43,.09); }.fee-card > div:first-child { display: flex; flex-direction: column; }.fee-card > div:first-child small { color: #74867e; font-size: .66rem; }.fee-card > div:first-child strong { margin: 5px 0 1px; color: #164434; font-size: 2rem; font-weight: 800; letter-spacing: -.05em; }.fee-card > div:first-child span { color: #94a09c; font-size: .59rem; }.fee-card hr { margin: 20px 0; border-color: #e2e9e5; }.fee-card__row { display: flex; align-items: center; justify-content: space-between; margin: 12px 0; color: #687b73; font-size: .68rem; }.fee-card__row strong { color: #294b40; font-size: .75rem; }.fee-card__row strong small { color: #8b9994; font-size: .55rem; }.fee-card > p { margin: 19px 0 0; padding: 12px; border-radius: 10px; color: #61766e; background: #f1f6f3; font-size: .6rem; }
.public-section--faq { display: grid; grid-template-columns: .65fr 1fr; gap: 70px; align-items: start; }.public-section--faq .public-section__header { margin: 0; }.public-faq { border-top: 1px solid #dfe7e2; }.public-faq .accordion-item { border-color: #dfe7e2; background: transparent; }.public-faq .accordion-button { padding: 18px 4px; color: #27493e; background: transparent; box-shadow: none; font-size: .76rem; font-weight: 800; }.public-faq .accordion-body { padding: 0 4px 18px; color: #71827b; font-size: .69rem; line-height: 1.65; }
.public-cta { display: flex; max-width: 1192px; margin: 35px auto 85px; padding: 43px; align-items: center; justify-content: space-between; gap: 25px; border-radius: 23px; color: #fff; background: linear-gradient(140deg,#1b513f,#0b2d23); }.public-cta span { color: #edc771; font-size: .62rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }.public-cta h2 { margin: 7px 0; font-size: 1.8rem; font-weight: 800; letter-spacing: -.04em; }.public-cta p { margin: 0; color: rgba(255,255,255,.58); font-size: .7rem; }
.public-footer { display: flex; max-width: 1192px; margin: auto; padding: 30px 0 40px; align-items: center; justify-content: space-between; gap: 24px; border-top: 1px solid #e1e8e4; }.public-footer p { margin: 0; color: #8a9691; font-size: .58rem; }.public-footer > div:last-child { display: flex; gap: 18px; }
@media (max-width: 991.98px) { .admission-hero { min-height: auto; padding-top: 60px; grid-template-columns: 1fr; }.admission-hero__panel { max-width: 600px; }.program-grid { grid-template-columns: repeat(2,1fr); }.admission-steps { grid-template-columns: repeat(2,1fr); }.admission-steps article:nth-child(2)::after { display: none; }.fee-layout { gap: 45px; grid-template-columns: 1fr; }.fee-card { max-width: 580px; }.public-section--faq { grid-template-columns: 1fr; gap: 30px; }.public-cta,.public-footer { margin-inline: 24px; } }
@media (max-width: 767.98px) { .admission-nav { padding-inline: 14px; }.admission-nav__actions .btn { padding-inline: .72rem; }.admission-hero { padding: 45px 14px 70px; }.admission-hero h1 { font-size: 2.7rem; }.public-metrics { margin-inline: 14px; padding: 20px 10px; grid-template-columns: repeat(2,1fr); gap: 20px 0; }.public-metrics > div:nth-child(2) { border: 0; }.program-grid { grid-template-columns: 1fr; }.public-section { padding: 68px 14px; }.public-section__header { align-items: flex-start; flex-direction: column; }.admission-steps { grid-template-columns: 1fr; }.admission-steps article { padding-right: 0; }.admission-steps article::after { display: none; }.public-cta { align-items: flex-start; flex-direction: column; margin: 20px 14px 60px; padding: 30px; }.public-footer { align-items: flex-start; flex-direction: column; margin-inline: 14px; }.public-footer p { line-height: 1.6; } }
@media (max-width: 479.98px) { .admission-nav .public-brand small { display: none; }.admission-nav .public-brand strong { font-size: .75rem; }.admission-hero__actions .btn { width: 100%; }.admission-trust { align-items: flex-start; flex-direction: column; gap: 8px; }.hero-panel__dates { gap: 8px; }.hero-panel__dates strong { font-size: .67rem; }.public-metrics strong { font-size: 1.05rem; }.fee-card { padding: 20px; } }
</style>
