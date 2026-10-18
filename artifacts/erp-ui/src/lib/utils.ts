/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { twMerge } from 'tailwind-merge';

import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
