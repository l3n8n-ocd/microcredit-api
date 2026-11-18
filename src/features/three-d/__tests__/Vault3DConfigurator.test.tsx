/**
 * FE-AA2 · the /3d-lab configurator. jsdom has no WebGL, so the viewport is a stand-in that records the
 * props the real canvas would receive. Queries are by role, label and text only (FE-09).
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Vault3DConfigurator } from '../Vault3DConfigurator.tsx'
import type { Vault3DCanvasProps } from '../Vault3DCanvas.tsx'

/** Called with the props on every render of the stand-in viewport. No calls means WebGL never mounted. */
const viewport = vi.fn<(props: Vault3DCanvasProps) => void>()

function FakeViewport(props: Vault3DCanvasProps) {
  viewport(props)
  return <div role="img" aria-label="Stand-in WebGL viewport" />
}

function viewportProps(): Vault3DCanvasProps {
  const props = viewport.mock.lastCall?.[0]
  if (props === undefined) throw new Error('the WebGL viewport was not rendered')
  return props
}

function renderLab(options: { webgl?: boolean; reducedMotion?: boolean } = {}) {
  return render(
    <Vault3DConfigurator Viewport={FakeViewport} webgl={options.webgl ?? true} reducedMotion={options.reducedMotion ?? false} />,
  )
}

/** A minimal binary glTF: the 12-byte header with the `glTF` magic. Enough for the pre-checks. */
function glbHeader(): ArrayBuffer {
  const bytes = new Uint8Array(12)
  bytes.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0])
  return bytes.buffer
}

beforeEach(() => {
  viewport.mockClear()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:sample'), revokeObjectURL: vi.fn() }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Vault3DConfigurator controls (§11 rule 1)', () => {
  it('every control is found by its label and reports aria-invalid="false" and a hint', () => {
    renderLab()
    const labels: (string | RegExp)[] = [
      /Deep Ledger Slate/,
      /Verification Emerald/,
      /Cloud Cobalt/,
      /Amber Gold/,
      /Obsidian Titanium/,
      'Custom chassis colour',
      'Metalness',
      'Roughness',
      'Wireframe',
      'NFC contactless shield + security ring',
      'Dual-screen receipt printer module',
      'Fintech Studio',
      'Cyber Vault Dark',
      'Warm Daylight',
      'Auto-rotate speed',
      'Pointer tilt',
      'Static blueprint (reduced motion / low power)',
      'Load a .glb or .gltf file',
    ]
    for (const label of labels) {
      const control = screen.getByLabelText(label)
      expect(control.getAttribute('aria-invalid'), String(label)).toBe('false')
      const hint = control.getAttribute('aria-describedby')
      expect(hint, String(label)).not.toBeNull()
      expect(document.getElementById((hint ?? '').split(' ')[0] ?? '')?.textContent, String(label)).not.toBe('')
    }
  })

  it('paint, finish, wireframe, module, lighting and auto-rotate reach the viewport', () => {
    renderLab()
    expect(viewportProps().config.chassisColor).toBe('#1e293b')

    fireEvent.click(screen.getByLabelText(/Cloud Cobalt/))
    expect(viewportProps().config.chassisColor).toBe('#0284c7')
    expect((screen.getByLabelText(/Cloud Cobalt/) as HTMLInputElement).checked).toBe(true)

    fireEvent.change(screen.getByLabelText('Custom chassis colour'), { target: { value: '#d97706' } })
    expect(viewportProps().config.chassisColor).toBe('#d97706')
    expect((screen.getByLabelText(/Amber Gold/) as HTMLInputElement).checked).toBe(true)

    fireEvent.change(screen.getByLabelText('Metalness'), { target: { value: '0.4' } })
    fireEvent.change(screen.getByLabelText('Roughness'), { target: { value: '0.85' } })
    expect(viewportProps().config.metalness).toBe(0.4)
    expect(viewportProps().config.roughness).toBe(0.85)
    expect(screen.getByText('0.40')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Wireframe'))
    expect(viewportProps().config.wireframe).toBe(true)

    fireEvent.click(screen.getByLabelText('Dual-screen receipt printer module'))
    expect(viewportProps().config.module).toBe('printer')

    fireEvent.click(screen.getByLabelText('Cyber Vault Dark'))
    expect(viewportProps().config.lighting).toBe('cyber-vault')

    expect(screen.getByText('off')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Auto-rotate speed'), { target: { value: '2' } })
    expect(viewportProps().config.autoRotateSpeed).toBe(2)

    fireEvent.click(screen.getByLabelText('Pointer tilt'))
    expect(viewportProps().config.pointerTilt).toBe(false)
  })

  it('201 and 409 triggers set the terminal state, replay on a second press, and announce it', () => {
    renderLab()
    fireEvent.click(screen.getByRole('button', { name: 'Simulate 201 Disbursed' }))
    expect(viewportProps().config.terminalState).toBe('disbursed')
    expect(screen.getByText(/201 Disbursed: the security ring spins emerald/)).toBeTruthy()
    const firstNonce = viewportProps().config.stateNonce

    fireEvent.click(screen.getByRole('button', { name: 'Simulate 201 Disbursed' }))
    expect(viewportProps().config.stateNonce).toBe(firstNonce + 1)

    fireEvent.click(screen.getByRole('button', { name: 'Simulate 409 Conflict' }))
    expect(viewportProps().config.terminalState).toBe('conflict')
    expect(screen.getByText(/409 Conflict: the ring pulses rose and the vault shutter locks/)).toBeTruthy()
    expect(viewportProps().label).toContain('409 Conflict')

    fireEvent.click(screen.getByRole('button', { name: 'Reset to idle' }))
    expect(viewportProps().config.terminalState).toBe('idle')
  })
})

describe('Static reduced-motion / low-power fallback', () => {
  it('the switch swaps WebGL for the SVG blueprint, unmounting the viewport', () => {
    renderLab()
    expect(screen.getByRole('img', { name: 'Stand-in WebGL viewport' })).toBeTruthy()
    const rendersBefore = viewport.mock.calls.length

    fireEvent.click(screen.getByLabelText('Static blueprint (reduced motion / low power)'))
    expect(screen.queryByRole('img', { name: 'Stand-in WebGL viewport' })).toBeNull()
    expect(viewport).toHaveBeenCalledTimes(rendersBefore)
    const blueprint = screen.getByRole('img', { name: /Isometric blueprint of the MicroCredit POS terminal/ })
    expect(blueprint.tagName.toLowerCase()).toBe('svg')
    expect(screen.getByText('WebGL not mounted · 0 KB of Three.js requested · 0 frames rendered')).toBeTruthy()

    // The blueprint follows the configurator.
    fireEvent.click(screen.getByRole('button', { name: 'Simulate 409 Conflict' }))
    expect(screen.getByRole('img', { name: /409 Conflict/ })).toBeTruthy()
    expect(screen.getByText('409 · LOCKED')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Static blueprint (reduced motion / low power)'))
    expect(screen.getByRole('img', { name: 'Stand-in WebGL viewport' })).toBeTruthy()
  })

  it('prefers-reduced-motion renders the blueprint and never mounts WebGL; the switch is locked on', () => {
    renderLab({ reducedMotion: true })
    expect(viewport).not.toHaveBeenCalled()
    expect(screen.getByRole('img', { name: /Shown because the system asks for reduced motion/ })).toBeTruthy()
    const toggle = screen.getByLabelText('Static blueprint (reduced motion / low power)') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(toggle.disabled).toBe(true)
  })

  it('no WebGL renders the blueprint and never mounts the viewport', () => {
    renderLab({ webgl: false })
    expect(viewport).not.toHaveBeenCalled()
    expect(screen.getByRole('img', { name: /Shown because this browser has no WebGL/ })).toBeTruthy()
  })
})

describe('.glb loading and the FE-10 Performance Lens', () => {
  it('a wrong file type is rejected with an alert tied to the input', async () => {
    renderLab()
    const input = screen.getByLabelText('Load a .glb or .gltf file')
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] } })
    })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('notes.txt: Only .glb or .gltf files load here.')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toContain(alert.id)
    expect(viewportProps().model).toBeNull()
  })

  it('a .glb dropped on the viewport is handed to the canvas', async () => {
    renderLab()
    const file = new File([glbHeader()], 'counter.glb', { type: 'model/gltf-binary' })
    await act(async () => {
      fireEvent.drop(screen.getByRole('region', { name: '3D viewport' }), { dataTransfer: { files: [file] } })
    })
    expect(viewportProps().model?.name).toBe('counter.glb')
    expect(viewportProps().model?.bytes.byteLength).toBe(12)
    expect(screen.getByRole('button', { name: 'Back to the POS terminal' })).toBeTruthy()
  })

  it('"Generate & load sample .glb" asks the canvas for a sample, loads it, and offers a download', () => {
    renderLab()
    expect(viewportProps().sampleRequest).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Generate & load sample .glb' }))
    expect(viewportProps().sampleRequest).toBe(1)

    act(() => viewportProps().onSample?.(glbHeader()))
    expect(viewportProps().model?.name).toBe('microcredit-pos-sample.glb')
    const link = screen.getByRole('link', { name: 'Download the sample .glb (12 B)' })
    expect(link.getAttribute('download')).toBe('microcredit-pos-sample.glb')

    act(() => viewportProps().onModelStatus?.({ kind: 'loaded', name: 'microcredit-pos-sample.glb', bytes: 301_670, triangles: 5992, draco: false }))
    expect(screen.getByText(/Loaded microcredit-pos-sample\.glb: 294\.6 KB, 5,992 triangles/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back to the POS terminal' }))
    expect(viewportProps().model).toBeNull()
  })

  it('the Performance Lens shows what the canvas measures', () => {
    renderLab()
    const lens = screen.getByRole('region', { name: 'FE-10 Performance Lens' })
    expect(within(lens).getByText('DPR (clamp 1–1.5)')).toBeTruthy()
    act(() =>
      viewportProps().onTelemetry?.({
        fps: 60,
        frameMs: 16.7,
        renderMs: 0.42,
        drawCalls: 13,
        triangles: 7632,
        dpr: 1.5,
        deviceDpr: 3,
        firstFrameMs: 292,
        lazyChunkBytes: 189_163,
        lazyChunkDecodedBytes: 750_054,
        lazyChunkCount: 1,
      }),
    )
    expect(within(lens).getByText('60')).toBeTruthy()
    expect(within(lens).getByText('16.7 ms / 0.42 ms')).toBeTruthy()
    expect(within(lens).getByText('13 · 7,632')).toBeTruthy()
    expect(within(lens).getByText('1.5x of 3x')).toBeTruthy()
    expect(within(lens).getByText('292 ms after mount')).toBeTruthy()
    expect(within(lens).getByText(/184\.7 KB compressed \(732\.5 KB of JavaScript\) in 1 file/)).toBeTruthy()
  })
})
