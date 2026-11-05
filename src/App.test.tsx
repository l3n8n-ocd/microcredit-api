import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App.tsx'

afterEach(() => {
  cleanup()
})

describe('App', () => {
  it('renders a main landmark with the product heading', () => {
    render(<App />)

    expect(screen.getByRole('main')).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'MicroCredit API' })).toBeDefined()
  })
})
