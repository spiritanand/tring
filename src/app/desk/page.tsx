import type { Metadata } from "next";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { Brand, Nav } from "@/components/nav";
import { displayBookingId, listBookings } from "@/lib/bookings";
import { getClinic } from "@/lib/clinic";
import { fmtDate, fmtTime, istDate, istMinutes } from "@/lib/time";
import type { SettingsInput } from "./actions";
import { AutoRefresh } from "./auto-refresh";
import { ResetButton } from "./reset-button";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Tring desk",
  robots: { index: false },
};

export default async function Desk() {
  const nowMs = Date.now();
  const [clinic, all, requestHeaders] = await Promise.all([
    getClinic(),
    listBookings(),
    headers(),
  ]);
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const proto =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const patientUrl = `${proto}://${host}/`;
  const qr = await QRCode.toString(patientUrl, {
    type: "svg",
    margin: 1,
    color: { dark: "#0c0c0a", light: "#facc15" },
  });

  const upcoming = all.filter(
    (b) => b.status === "confirmed" && b.endAt > nowMs,
  );
  const rest = all
    .filter((b) => !(b.status === "confirmed" && b.endAt > nowMs))
    .reverse();
  const rows = [...upcoming, ...rest];
  const { id: _id, ...settings } = clinic;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6">
      <AutoRefresh seconds={5} />
      <header className="flex h-14 items-center justify-between border-b border-line">
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          <Brand />
          <Nav />
        </div>
        <span className="hidden text-meta text-muted sm:inline">
          {clinic.name}
        </span>
      </header>

      <section className="py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-title">Bookings</h1>
            <p className="mt-1 text-meta text-muted">
              <span className="tabular-nums">{upcoming.length}</span> upcoming
              with {clinic.doctorName}. Updates every few seconds.
            </p>
          </div>
          <ResetButton />
        </div>

        {rows.length === 0 ? (
          <p className="card mt-5 text-sm text-muted">
            No bookings yet. When a patient confirms in the chat, the
            appointment appears here.
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-line bg-wash">
                <tr>
                  {[
                    "When",
                    "Patient",
                    "Mobile",
                    "Reason for visit",
                    "Status",
                    "Booking ID",
                  ].map((h) => (
                    <th key={h} className="label px-4 py-2.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((b) => {
                  const live = b.status === "confirmed" && b.endAt > nowMs;
                  return (
                    <tr key={b.id} className={live ? "" : "text-muted"}>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                        {fmtDate(istDate(b.startAt))},{" "}
                        {fmtTime(istMinutes(b.startAt))}
                      </td>
                      <td className="px-4 py-3">{b.patientName}</td>
                      <td className="px-4 py-3 font-mono text-meta">
                        {b.phone}
                      </td>
                      <td className="max-w-[16rem] px-4 py-3 break-words">
                        {b.reason}
                      </td>
                      <td className="px-4 py-3">
                        {b.status === "cancelled" ? (
                          <span className="chip-bad">
                            <span className="dot" />
                            Cancelled
                          </span>
                        ) : live ? (
                          <span className="chip-ok">
                            <span className="dot" />
                            Confirmed
                          </span>
                        ) : (
                          <span className="chip-mute">
                            <span className="dot" />
                            Past
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-meta">
                        {displayBookingId(b.id)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="border-t border-line py-8">
        <h2 className="text-heading">Share the booking link</h2>
        <div className="mt-4 flex flex-wrap items-center gap-5">
          {/* biome-ignore lint/performance/noImgElement: an inline SVG data URL, nothing for next/image to optimise */}
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(qr)}`}
            alt="QR code for the patient booking chat"
            width={148}
            height={148}
            className="rounded-lg border border-line"
          />
          <div>
            <p className="text-sm">
              Patients scan this, or open the link, and book in the chat. No app
              and no login.
            </p>
            <p className="mt-2 font-mono text-meta text-brand break-all">
              {patientUrl}
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-line py-8">
        <h2 className="text-heading">Clinic settings</h2>
        <p className="mt-1 mb-5 text-meta text-muted">
          Changes apply to new bookings. Existing appointments stay where they
          are.
        </p>
        <SettingsForm initial={settings as SettingsInput} />
      </section>
    </div>
  );
}
