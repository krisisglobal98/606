// Apply the saved theme before first paint to avoid a light flash in dark mode.
// A file rather than an inline <script>, so the Content-Security-Policy can stay script-src 'self'.
try {
  var s = JSON.parse(localStorage.getItem('dod.ui') || localStorage.getItem('dor.ui') || 'null')
  var st = s && s.state && s.state.settings
  if (st) {
    document.documentElement.dataset.theme = st.theme
    document.documentElement.dataset.density = st.density
  }
} catch (e) {}
