import { setHeader } from './ui.js';

// Content pages don't load Supabase. A stored Supabase session is enough to show "Min side";
// /deltager checks the session properly when it opens.
function hasSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const session = JSON.parse(localStorage.getItem(key));
        if (session?.refresh_token) return true;
      }
    }
  } catch {
    // Storage blocked: show "Log ind".
  }
  return false;
}

// The auction pages set the header themselves once they know the user.
if (!document.querySelector('script[src="/auction.js"]')) setHeader({ loggedIn: hasSession() });
