<script setup lang="ts">
// The welcome / landing screen: what Ledgerful is, and why your records are
// safe with it. Shown on first open (App.vue remembers that it was seen) and
// from the side menu any time. It explains, it doesn't advise: trust first.
//
// Every claim here must stay true. The app's only network request is to its
// own site, to check for a newer version (useVersionCheck / the service
// worker); no analytics, no third-party scripts or fonts, no accounts.
import { onBeforeUnmount, onMounted } from 'vue'
import { CloudOff, FileLock2, History, TrendingUp, UserX, Wallet, WifiOff } from '@lucide/vue'

defineProps<{ first: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
    <div class="inner">
      <header class="hero">
        <img class="logo" src="/favicon.svg" alt="" width="56" height="56" />
        <h1 id="welcome-title">Ledgerful</h1>
        <p class="tagline">Keep records of your money. See the patterns. Forecast what's ahead.</p>
      </header>

      <section class="block">
        <h2>Your records never leave this device</h2>
        <ul class="points">
          <li>
            <FileLock2 class="pi" aria-hidden="true" />
            <div>
              <b>Every record is a file on this device.</b>
              <span>Each balance sheet you save is a small file kept in this app's private storage, on this device. That file is the only copy, and only you can open it.</span>
            </div>
          </li>
          <li>
            <CloudOff class="pi" aria-hidden="true" />
            <div>
              <b>Nothing is sent anywhere.</b>
              <span>Ledgerful has no servers for your data and no cloud copy. Nothing you enter is uploaded, synced or shared.</span>
            </div>
          </li>
          <li>
            <UserX class="pi" aria-hidden="true" />
            <div>
              <b>No account, no tracking.</b>
              <span>No sign-up, no email, no ads, no analytics. The only thing the app asks the internet for is a newer version of itself.</span>
            </div>
          </li>
          <li>
            <WifiOff class="pi" aria-hidden="true" />
            <div>
              <b>Works offline.</b>
              <span>Once it's open, it runs without a connection. Your figures never need one.</span>
            </div>
          </li>
        </ul>
      </section>

      <section class="block">
        <h2>Three views of your money</h2>
        <ul class="tabs-list">
          <li><History class="ti" aria-hidden="true" /><div><b>Past</b><span>How every account has moved: totals, each line over time, averages and daily rates.</span></div></li>
          <li><Wallet class="ti" aria-hidden="true" /><div><b>Present</b><span>Your latest balance sheet. Save a new record whenever you check your accounts.</span></div></li>
          <li><TrendingUp class="ti" aria-hidden="true" /><div><b>Future</b><span>Forecasts from what you expect, or from patterns in your own records.</span></div></li>
        </ul>
      </section>

      <button class="btn primary go" @click="emit('close')">{{ first ? 'Get started' : 'Back to Ledgerful' }}</button>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  position: fixed;
  inset: 0;
  z-index: 120;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: var(--bg-image), var(--bg);
  background-attachment: fixed;
  animation: fade 0.2s ease-out;
}

@keyframes fade {
  from {
    opacity: 0;
  }
}

.inner {
  max-width: 34rem;
  margin: 0 auto;
  padding: max(2rem, env(safe-area-inset-top)) 1.25rem max(2rem, env(safe-area-inset-bottom));
  display: grid;
  gap: 1.4rem;
}

.hero {
  text-align: center;
  display: grid;
  justify-items: center;
  gap: 0.35rem;
  padding-top: 0.5rem;
}

.logo {
  width: 56px;
  height: 56px;
  border-radius: 14px;
}

.hero h1 {
  margin: 0.3rem 0 0;
  font-size: 2rem;
}

.tagline {
  margin: 0;
  color: var(--mute);
  font-size: 1.02rem;
  max-width: 22rem;
}

.block {
  padding: 1rem 1rem 0.6rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
}

.block h2 {
  margin: 0 0 0.7rem;
  font-size: 1.1rem;
}

.points,
.tabs-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.85rem;
}

.points li {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  gap: 0.7rem;
  align-items: start;
}

.points li div {
  display: grid;
  gap: 0.15rem;
  font-size: 0.93rem;
  line-height: 1.45;
}

.points span,
.tabs-list span {
  color: var(--mute);
}

.pi {
  width: 24px;
  height: 24px;
  stroke-width: 1.6;
  color: var(--accent);
  margin-top: 0.1rem;
}

.tabs-list {
  padding-bottom: 0.4rem;
}

.tabs-list li {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  gap: 0.7rem;
  align-items: start;
  font-size: 0.93rem;
  line-height: 1.45;
}

.tabs-list li div {
  display: grid;
  gap: 0.1rem;
}

.ti {
  width: 20px;
  height: 20px;
  stroke-width: 1.75;
  margin-top: 0.15rem;
}

.go {
  justify-self: center;
  min-width: 12rem;
}

@media (prefers-reduced-motion: reduce) {
  .welcome {
    animation: none;
  }
}
</style>
