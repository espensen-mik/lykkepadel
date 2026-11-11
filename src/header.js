import { setHeader, sessionUserId } from './ui.js';

// Content pages don't load Supabase. A stored session is enough to show "Min side" (or "Admin");
// the pages behind the button check the session properly when they open.
// The auction pages set the header themselves once they know the user.
if (!document.querySelector('script[src="/auction.js"]')) setHeader({ loggedIn: Boolean(sessionUserId()) });
