import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { OrderList, useOrders } from "@/components/OrderHistory";

export const Route = createFileRoute("/orders")({
  head: () => ({
    meta: [
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      { title: "Order History — Golden Compass" },
      { name: "description", content: "Every buy and sell order placed from your Golden Compass account, with live status." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Order History — Golden Compass" },
      { property: "og:description", content: "Track the status of your stock orders." },
      { property: "og:url", content: "/orders" },
    ],
    links: [{ rel: "canonical", href: "/orders" }],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  const { user, loading: authLoading } = useAuth();
  const { orders, loading } = useOrders(user?.id);

  if (authLoading) return null;
  if (!user) return <Navigate to="/login" />;

  return (
    <div className="flex flex-col gap-5 px-5 pt-6 pb-28 anim-fade-up">
      <header>
        <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
          THE SHIP'S LEDGER
        </p>
        <h1 className="t-display t-gold mt-1" style={{ fontSize: 22 }}>
          Order History
        </h1>
        <Link to="/trade" className="t-mono t-sec" style={{ fontSize: 10, textDecoration: "underline" }}>
          Place a new order →
        </Link>
      </header>

      {loading ? <div className="skeleton h-24 w-full rounded-2xl" /> : <OrderList orders={orders} />}
    </div>
  );
}
