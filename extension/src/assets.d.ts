// esbuild bundles these as text (`--loader:.html=text`).
declare module '*.html' {
  const text: string
  export default text
}
