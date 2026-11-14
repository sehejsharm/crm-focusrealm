import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { BrandLoader } from "./components/brand";
import { CallProvider } from "./components/call";
import { ConfettiHost } from "./components/motion";
import { Shell } from "./layouts/Shell";
import { lastPortal, useAuth } from "./lib/auth";
import { LiveProvider } from "./lib/live";
import Login from "./pages/Login";

// Every page is its own small download. Naming the loaders lets the pages a
// person is about to need be fetched ahead of the click.
const load = {
  Welcome: () => import("./pages/Welcome"),
  Profile: () => import("./pages/Profile"),
  PhoneLink: () => import("./pages/phone/PhoneLink"),
  MyDay: () => import("./pages/sales/MyDay"),
  Recordings: () => import("./pages/sales/Recordings"),
  Sprint: () => import("./pages/sales/Sprint"),
  Prospects: () => import("./pages/shared/Prospects"),
  Pipeline: () => import("./pages/shared/Pipeline"),
  ContactDetail: () => import("./pages/shared/ContactDetail"),
  Calls: () => import("./pages/shared/Calls"),
  CallDetail: () => import("./pages/shared/CallDetail"),
  Tasks: () => import("./pages/shared/Tasks"),
  Coaching: () => import("./pages/shared/Coaching"),
  Team: () => import("./pages/shared/Team"),
  Reports: () => import("./pages/shared/Reports"),
  ReportDetail: () => import("./pages/shared/ReportDetail"),
  Intelligence: () => import("./pages/shared/Intelligence"),
  Allocation: () => import("./pages/shared/Allocation"),
  Command: () => import("./pages/founder/Command"),
  People: () => import("./pages/founder/People"),
  Settings: () => import("./pages/founder/Settings"),
  Audit: () => import("./pages/founder/Audit"),
  LegionHome: () => import("./pages/legion/LegionHome"),
  Handoffs: () => import("./pages/legion/Handoffs"),
  Meetings: () => import("./pages/legion/Meetings"),
};

const Welcome = lazy(load.Welcome);
const Profile = lazy(load.Profile);
const PhoneLink = lazy(load.PhoneLink);
const MyDay = lazy(load.MyDay);
const Recordings = lazy(load.Recordings);
const Sprint = lazy(load.Sprint);
const Prospects = lazy(load.Prospects);
const Pipeline = lazy(load.Pipeline);
const ContactDetail = lazy(load.ContactDetail);
const Calls = lazy(load.Calls);
const CallDetail = lazy(load.CallDetail);
const Tasks = lazy(load.Tasks);
const Coaching = lazy(load.Coaching);
const Team = lazy(load.Team);
const Reports = lazy(load.Reports);
const ReportDetail = lazy(load.ReportDetail);
const Intelligence = lazy(load.Intelligence);
const Allocation = lazy(load.Allocation);
const Command = lazy(load.Command);
const People = lazy(load.People);
const Settings = lazy(load.Settings);
const Audit = lazy(load.Audit);
const LegionHome = lazy(load.LegionHome);
const Handoffs = lazy(load.Handoffs);
const Meetings = lazy(load.Meetings);

/** The pages each portal opens most, its home page first. */
const COMMON: Record<string, (keyof typeof load)[]> = {
  founder: ["Command", "Pipeline", "Prospects", "Tasks", "ContactDetail", "Calls", "Team", "CallDetail"],
  sales: ["MyDay", "Sprint", "Prospects", "Tasks", "ContactDetail", "Pipeline", "Calls", "Recordings"],
  legion: ["LegionHome", "Handoffs", "Meetings", "Pipeline", "ContactDetail", "Tasks"],
};

// This browser has signed in before: start fetching that portal's home page
// now, alongside the sign-in check, instead of after it.
const returning = lastPortal();
if (returning && COMMON[returning] && location.pathname !== "/login") void load[COMMON[returning][0]]().catch(() => {});

/** Once the first page is up, quietly fetch the other pages this portal uses most. */
function usePagePreload(portal?: string) {
  useEffect(() => {
    const names = portal ? COMMON[portal] : undefined;
    if (!names) return;
    // Respect data saver and very slow connections: load pages only when opened.
    const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData || /2g/.test(conn?.effectiveType ?? "")) return;
    const whenIdle: (fn: () => void) => void = "requestIdleCallback" in window ? (fn) => window.requestIdleCallback(fn) : (fn) => setTimeout(fn, 400);
    let i = 0;
    let cancelled = false;
    const next = () => {
      if (cancelled || i >= names.length) return;
      void load[names[i++]]().catch(() => {}).finally(() => whenIdle(next));
    };
    // Let the first page and its data go first.
    const t = setTimeout(() => whenIdle(next), 1500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [portal]);
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  usePagePreload(user && !user.must_change_password ? user.portal : undefined);
  if (loading) return <BrandLoader label="Opening your workspace" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (user.must_change_password && loc.pathname !== "/welcome") return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}

/** Links can point at another portal (e.g. a notification); keep everyone in their own. */
function PortalGuard({ portal, children }: { portal: "sales" | "legion" | "founder"; children: ReactNode }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (user && user.portal !== portal) {
    const rest = loc.pathname.replace(/^\/(sales|legion|founder)/, "");
    const shared = /^\/(contacts|calls|reports|pipeline|team)(\/|$)/.test(rest);
    return <Navigate to={`/${user.portal}${shared ? rest : ""}`} replace />;
  }
  return <>{children}</>;
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? `/${user.portal}` : "/login"} replace />;
}

const fallback = <div className="grid min-h-[50vh] place-items-center"><span className="size-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" /></div>;

export default function App() {
  return (
    <>
      <ConfettiHost />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <Protected>
              <LiveProvider>
                <CallProvider>
                  <Suspense fallback={fallback}>
                    <Routes>
                      <Route path="/" element={<Home />} />
                      <Route path="/welcome" element={<Welcome />} />
                      <Route path="/phone" element={<PhoneLink />} />
                      <Route element={<Shell />}>
                        <Route path="/profile" element={<Profile />} />

                        <Route path="/sales/*" element={<PortalGuard portal="sales"><SalesRoutes /></PortalGuard>} />
                        <Route path="/legion/*" element={<PortalGuard portal="legion"><LegionRoutes /></PortalGuard>} />
                        <Route path="/founder/*" element={<PortalGuard portal="founder"><FounderRoutes /></PortalGuard>} />
                      </Route>
                      <Route path="*" element={<Home />} />
                    </Routes>
                  </Suspense>
                </CallProvider>
              </LiveProvider>
            </Protected>
          }
        />
      </Routes>
    </>
  );
}

function Shared() {
  return (
    <>
      <Route path="pipeline" element={<Pipeline />} />
      <Route path="contacts/:id" element={<ContactDetail />} />
      <Route path="calls" element={<Calls />} />
      <Route path="calls/:id" element={<CallDetail />} />
      <Route path="reports" element={<Reports />} />
      <Route path="reports/:id" element={<ReportDetail />} />
      <Route path="team" element={<Team />} />
    </>
  );
}

function SalesRoutes() {
  return (
    <Routes>
      <Route index element={<MyDay />} />
      <Route path="prospects" element={<Prospects scope="mine" />} />
      <Route path="follow-ups" element={<Tasks mode="mine" />} />
      <Route path="recordings" element={<Recordings />} />
      <Route path="sprint" element={<Sprint />} />
      <Route path="coaching" element={<Coaching />} />
      <Route path="coaching/:id" element={<ReportDetail />} />
      <Route path="allocation" element={<Allocation />} />
      <Route path="database" element={<Prospects scope="all" />} />
      <Route path="intelligence" element={<Intelligence />} />
      <Route path="tasks" element={<Tasks mode="team" />} />
      {Shared()}
      <Route path="*" element={<Navigate to="/sales" replace />} />
    </Routes>
  );
}

function LegionRoutes() {
  return (
    <Routes>
      <Route index element={<LegionHome />} />
      <Route path="handoffs" element={<Handoffs />} />
      <Route path="meetings" element={<Meetings />} />
      <Route path="tasks" element={<Tasks mode="team" />} />
      {Shared()}
      <Route path="*" element={<Navigate to="/legion" replace />} />
    </Routes>
  );
}

function FounderRoutes() {
  return (
    <Routes>
      <Route index element={<Command />} />
      <Route path="database" element={<Prospects scope="all" />} />
      <Route path="allocation" element={<Allocation />} />
      <Route path="intelligence" element={<Intelligence />} />
      <Route path="tasks" element={<Tasks mode="team" />} />
      <Route path="legion" element={<LegionHome />} />
      <Route path="people" element={<People />} />
      <Route path="settings" element={<Settings />} />
      <Route path="audit" element={<Audit />} />
      {Shared()}
      <Route path="*" element={<Navigate to="/founder" replace />} />
    </Routes>
  );
}
