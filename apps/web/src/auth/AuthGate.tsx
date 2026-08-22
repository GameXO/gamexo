/**
 * Sign in, or sign up. One component so the two share a single mounted state and
 * switching between them is instant — no route, no reload, no lost typing.
 */
import { useState } from 'react'
import LoginPage from './LoginPage'
import SignupPage from './SignupPage'

export default function AuthGate() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')

  return mode === 'signup' ? (
    <SignupPage onSignIn={() => setMode('login')} />
  ) : (
    <LoginPage onCreateAccount={() => setMode('signup')} />
  )
}
