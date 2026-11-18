/** FE-AA2 · what the viewport shows while the lazy Three.js chunk downloads. */
export function ViewportLoading() {
  return (
    <div role="status" className="flex size-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-white text-sm text-slate-600">
      Loading the 3D viewport (Three.js chunk)…
    </div>
  )
}
