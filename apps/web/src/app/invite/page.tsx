import type { Metadata } from 'next';
import { InviteForm } from '@/components/account/invite-form';

export const metadata: Metadata = { title: '接受邀請', referrer: 'no-referrer' };

export default function InvitePage() {
  return (
    <section aria-labelledby="invite-title" className="space-y-4">
      <h1 id="invite-title" className="text-2xl font-bold">
        接受邀請
      </h1>
      <InviteForm />
    </section>
  );
}
