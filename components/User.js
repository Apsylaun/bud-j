'use client';
import { createContext, useContext } from 'react';

export const UserContext = createContext({ name: '' });
export const useUser = () => useContext(UserContext);

// Prénom affiché : user_metadata.display_name si défini, sinon début de l'email (yann.martin@… -> Yann).
export function displayName(user) {
  const meta = user && user.user_metadata && user.user_metadata.display_name;
  if (meta) return meta;
  const first = ((user && user.email) || '').split('@')[0].split(/[._+\-\d]/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';
}
