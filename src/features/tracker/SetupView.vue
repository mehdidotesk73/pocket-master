<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { KIND_LABEL, type LineDef, type LineKind, isPositive, newId } from '../../lib/finance'
import { fmtDate } from '../../lib/money'
import { markUnsaved, refreshHealth, storeState } from '../../lib/storage/store'
import { exportAll, formatBytes } from '../../lib/storage/useStore'
import { type ImportBundle, useTracker } from './useTracker'

const { settings, records, saveSettings, readImport, applyImport } = useTracker()

// ---------------------------------------------------------------- lines editor (draft)

const snapshot = (): LineDef[] => JSON.parse(JSON.stringify(settings.value.lines))
const draft = ref<LineDef[]>(snapshot())
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(snapshot()))
watch(dirty, (d) => markUnsaved('setup', d), { immediate: true })
onBeforeUnmount(() => markUnsaved('setup', false))
watch(settings, () => {
  if (!dirty.value) draft.value = snapshot()
})

const KINDS: LineKind[] = ['account', 'card', 'bill', 'paying', 'receiving']

function add() {
  draft.value.push({ id: newId(), name: '', kind: 'account' })
}
function remove(id: string) {
  draft.value = draft.value.filter((l) => l.id !== id)
}
function move(i: number, by: number) {
  const j = i + by
  if (j < 0 || j >= draft.value.length) return
  const a = [...draft.value]
  ;[a[i], a[j]] = [a[j], a[i]]
  draft.value = a
}
function onKind(l: LineDef) {
  if (l.kind === 'card') l.share ??= 100
  else delete l.share
}
function setShare(l: LineDef, v: string) {
  const n = Number(v)
  l.share = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 100
}

const saving = ref(false)
const lineError = ref('')
async function save() {
  lineError.value = ''
  if (draft.value.some((l) => !l.name.trim())) {
    lineError.value = 'Every line needs a name.'
    return
  }
  saving.value = true
  try {
    await saveSettings({ ...settings.value, lines: draft.value.map((l) => ({ ...l, name: l.name.trim() })) })
    draft.value = snapshot()
  } finally {
    saving.value = false
  }
}

// ---------------------------------------------------------------- data

const busy = ref(false)
const msg = ref('')
const err = ref('')
const pending = ref<ImportBundle | null>(null)
const fileInput = ref<HTMLInputElement>()

async function doExport() {
  busy.value = true
  msg.value = err.value = ''
  try {
    const r = await exportAll()
    msg.value =
      r === 'cancelled'
        ? ''
        : r === 'shared'
          ? 'Backup ready. If you tapped “Save to Files”, it’s in the Files app.'
          : 'Backup saved.'
  } catch (e) {
    err.value = `Export failed: ${(e as Error).message}`
  } finally {
    busy.value = false
  }
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  msg.value = err.value = ''
  try {
    pending.value = await readImport(file)
  } catch (e2) {
    err.value = (e2 as Error).message
  }
}

async function confirmImport(mode: 'merge' | 'replace') {
  if (!pending.value) return
  busy.value = true
  try {
    await applyImport(pending.value, mode)
    msg.value = `Imported ${pending.value.recordCount} record${pending.value.recordCount === 1 ? '' : 's'}${
      pending.value.files.some((f) => f.id === 'settings') ? ' and your setup' : ''
    }.`
    pending.value = null
    await refreshHealth()
  } catch (e) {
    err.value = `Import failed: ${(e as Error).message}`
  } finally {
    busy.value = false
  }
}

const h = computed(() => storeState.health)
</script>

<template>
  <div class="setup">
    <section class="card">
      <h2>Record lines</h2>
      <p class="muted small intro">
        The things each record asks for. Enter amounts as positive numbers; the kind decides whether a
        line adds to or subtracts from <b>left so far</b>. Changing lines here never changes records you’ve
        already saved.
      </p>

      <div v-for="(l, i) in draft" :key="l.id" class="line">
        <input v-model="l.name" class="input name" placeholder="Name" aria-label="Line name" />
        <select v-model="l.kind" class="select kind" aria-label="Kind" @change="onKind(l)">
          <option v-for="k in KINDS" :key="k" :value="k">{{ KIND_LABEL[k] }}</option>
        </select>
        <label v-if="l.kind === 'card'" class="share">
          <span class="muted small">my share</span>
          <input
            class="input num"
            inputmode="decimal"
            :value="l.share ?? 100"
            aria-label="Default my share percent"
            @change="setShare(l, ($event.target as HTMLInputElement).value)"
          />
          <span class="muted small">%</span>
        </label>
        <span v-else class="hint small" :class="isPositive(l.kind) ? 'pos' : 'neg'">
          {{ isPositive(l.kind) ? 'adds' : 'subtracts' }}
        </span>
        <div class="tools">
          <button class="icon" :disabled="i === 0" aria-label="Move up" @click="move(i, -1)">↑</button>
          <button class="icon" :disabled="i === draft.length - 1" aria-label="Move down" @click="move(i, 1)">↓</button>
          <button class="icon rm" :aria-label="`Remove ${l.name || 'line'}`" @click="remove(l.id)">✕</button>
        </div>
      </div>

      <button class="btn add" @click="add">+ Add line</button>
      <p v-if="lineError" class="err small">{{ lineError }}</p>
    </section>

    <section class="card">
      <h2>Your data</h2>
      <p class="muted small intro">
        Everything is stored only on this device, inside this app. Deleting the app from your Home Screen
        deletes the data too, so back up now and then.
      </p>

      <div class="data-actions">
        <button class="btn primary" :disabled="busy" @click="doExport">Export all</button>
        <button class="btn" :disabled="busy" @click="fileInput?.click()">Import…</button>
        <input
          ref="fileInput"
          type="file"
          accept=".zip,.json,application/zip,application/json"
          hidden
          @change="onFile"
        />
      </div>

      <div v-if="pending" class="confirm">
        <p>
          This file has <b>{{ pending.recordCount }}</b> record{{ pending.recordCount === 1 ? '' : 's' }}
          <template v-if="pending.files.some((f) => f.id === 'settings')"> and a setup</template>.
          How should it be added?
        </p>
        <div class="data-actions">
          <button class="btn" :disabled="busy" @click="confirmImport('merge')">Merge</button>
          <button class="btn danger" :disabled="busy" @click="confirmImport('replace')">Replace everything</button>
          <button class="btn ghost" :disabled="busy" @click="pending = null">Cancel</button>
        </div>
        <p class="muted small">
          Merge keeps your current records and adds these (same dates are replaced). Replace deletes what’s here
          first.
        </p>
      </div>

      <p v-if="msg" class="ok small">{{ msg }}</p>
      <p v-if="err" class="err small">{{ err }}</p>

      <dl class="health small">
        <dt>Last backup</dt>
        <dd>{{ storeState.lastExport ? fmtDate(storeState.lastExport.slice(0, 10)) : 'never' }}</dd>
        <dt>Records</dt>
        <dd>{{ records.length }}</dd>
        <dt>Storage</dt>
        <dd>
          {{ storeState.backend === 'opfs' ? 'Files on this device' : 'Not available: nothing is kept' }} ·
          {{ formatBytes(h.usageBytes) }} used
        </dd>
        <dt>Installed app</dt>
        <dd :class="{ warn: !h.installed }">{{ h.installed ? 'Yes' : 'No — opened in a browser tab' }}</dd>
        <dt>Protected from clean-up</dt>
        <dd :class="{ warn: h.persisted === false }">
          {{ h.persisted == null ? 'Unknown' : h.persisted ? 'Yes' : 'No' }}
        </dd>
      </dl>
    </section>

    <div v-if="dirty" class="draft-bar">
      <span class="msg">Unsaved line changes.</span>
      <button class="btn ghost" @click="draft = snapshot()">Discard</button>
      <button class="btn primary" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save changes' }}</button>
    </div>
  </div>
</template>

<style scoped>
.setup > .card + .card {
  margin-top: 1rem;
}

.intro {
  margin: -0.3rem 0 0.75rem;
}

.line {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas:
    'name name'
    'kind kind'
    'extra tools';
  gap: 0.4rem;
  align-items: center;
  padding: 0.6rem 0;
  border-top: 1px solid var(--line);
}

@media (min-width: 40rem) {
  .line {
    grid-template-columns: 1fr 11rem 9rem auto;
    grid-template-areas: 'name kind extra tools';
  }
}

.name {
  grid-area: name;
}
.kind {
  grid-area: kind;
}
.share,
.hint {
  grid-area: extra;
}
.tools {
  grid-area: tools;
  display: flex;
}

.share {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.share .input {
  width: 4.5rem;
}

.hint {
  font-weight: 600;
}

.icon {
  width: var(--tap);
  height: var(--tap);
  border: none;
  background: none;
  color: var(--mute);
  font-size: 1rem;
}

.icon:disabled {
  opacity: 0.3;
}

.add {
  margin-top: 0.5rem;
}

.data-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.confirm {
  margin-top: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--projection);
  border-radius: 0.6rem;
}

.confirm p {
  margin: 0 0 0.6rem;
}

.confirm p.small {
  margin: 0.6rem 0 0;
}

.health {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.3rem 1rem;
  margin: 1rem 0 0;
}

.health dt {
  color: var(--mute);
}

.health dd {
  margin: 0;
}

.warn {
  color: var(--projection);
}

.ok {
  color: var(--accent);
}

.err {
  color: var(--negative);
}

@media (max-width: 30rem) {
  .draft-bar .msg {
    display: none;
  }
  .draft-bar .btn {
    flex: 1;
  }
}
</style>
