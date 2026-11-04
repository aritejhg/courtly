import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Courtly SG — Find your next good game',
  description: 'A calmer way to explore Singapore court swaps, save your usual places, and check your journey.',
  openGraph: { title: 'Courtly SG — Find your next good game', description: 'Explore Singapore court swaps and check the journey from your saved places.', type: 'website', images: ['/og.png'] },
  twitter: { card: 'summary_large_image', title: 'Courtly SG — Find your next good game', description: 'Explore Singapore court swaps and check the journey from your saved places.', images: ['/og.png'] },
};

const analyticsToken = import.meta.env.VITE_CLOUDFLARE_ANALYTICS_TOKEN;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* Cloudflare Web Analytics (free, cookieless). The token is public by design. */}
        {analyticsToken && (
          <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon={JSON.stringify({ token: analyticsToken })} />
        )}
      </body>
    </html>
  );
}
