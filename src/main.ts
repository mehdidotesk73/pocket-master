import { createApp } from 'vue'
import App from './App.vue'
import { installErrorCapture } from './debug'
// Fonts are bundled (and precached) so the app looks right offline.
import '@fontsource/red-hat-display/latin-800.css'
import '@fontsource/red-hat-text/latin-400.css'
import '@fontsource/red-hat-text/latin-600.css'
import '@fontsource/red-hat-text/latin-700.css'
import './styles/vars.css'

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
