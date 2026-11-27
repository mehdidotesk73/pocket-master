// Clipboard helpers with fallbacks for phones.
//
// Writing: navigator.clipboard.writeText needs a secure context and, on iOS,
// a user gesture; the hidden-textarea + execCommand('copy') path covers the rest.
// Reading: navigator.clipboard.readText shows iOS's "Paste" confirmation bubble
// and may be refused; callers fall back to a box the user pastes into by hand.

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length) // iOS ignores select() alone
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  }
}

/** The clipboard's text, or null when the browser won't give it (then ask the user to paste). */
export async function readClipboardText(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null
    return await navigator.clipboard.readText()
  } catch {
    return null
  }
}
