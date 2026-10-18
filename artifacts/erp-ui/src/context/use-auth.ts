/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useContext } from 'react';
import { AuthContext } from './auth-context';

export function useAuth() {
  return useContext(AuthContext);
}
