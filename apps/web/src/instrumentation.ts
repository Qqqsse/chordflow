/** Next.js start-up hook: schedules audio-upload retention (database mode, Node.js runtime only). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startUploadMaintenance } = await import('./server/uploads/maintenance');
  startUploadMaintenance();
}
