import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { LoginResult, RoleInfo, UserInfo } from '@/types'

interface AuthState {
  token: string | null
  user: UserInfo | null
  role: RoleInfo | null
  style: string
  setSession: (result: LoginResult) => void
  setRole: (role: RoleInfo) => void
  setUser: (user: UserInfo) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      role: null,
      style: 'default',
      setSession: (result) =>
        set({
          token: result.token,
          user: result,
          role: result.role,
          style: result.style || 'default',
        }),
      setRole: (role) => set({ role }),
      setUser: (user) => set({ user }),
      clear: () => set({ token: null, user: null, role: null }),
    }),
    {
      name: 'msop.session',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        role: state.role,
        style: state.style,
      }),
    },
  ),
)

export function getToken() {
  return useAuthStore.getState().token
}
