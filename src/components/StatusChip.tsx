// One status chip for money rows (design D14): readable text, never colour alone, no emoji.
const MAP: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "#F5B041" },
  processing: { label: "Paying out", color: "#F5B041" },
  confirmed: { label: "Done", color: "#58D68D" },
  failed: { label: "Failed", color: "#FF8A73" },
  cancelled: { label: "Cancelled", color: "#FF8A73" },
  held_for_review: { label: "Under review", color: "#85C1E9" },
};

export function StatusChip({ status }: { status: string | null | undefined }) {
  const s = MAP[status ?? "pending"] ?? { label: String(status ?? "Pending"), color: "#E8D7B4" };
  return (
    <span
      className="t-status inline-flex items-center gap-1.5"
      style={{ color: s.color }}
    >
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: s.color, display: "inline-block" }} />
      {s.label}
    </span>
  );
}
