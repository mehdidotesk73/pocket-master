import { createApp } from 'vue'
import App from './App.vue'
import { installErrorCapture } from './debug'
// Fraunces is the display serif every look shares (same as the Markdown Lab
// editor); bundled and precached so headings look right offline.
import '@fontsource/fraunces/latin-500.css'
import '@fontsource/fraunces/latin-600.css'
import './styles/themes.css'
import './styles/vars.css'
// Sets data-theme on <html> at import time, before the first paint.
import './lib/useTheme'

const app = createApp(App)

// Before mount, so a crash during the first render still reaches the log panel.
installErrorCapture(app)

// "Reload latest" adds ?fresh=<ts> to bust caches; drop it so it isn't
// bookmarked or shared. The service worker is registered from App.vue.
const loaded = new URL(location.href)
if (loaded.searchParams.has('fresh')) {
  loaded.searchParams.delete('fresh')
  history.replaceState(history.state, '', loaded.toString())
}

app.mount('#app')
