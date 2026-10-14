import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { BrandLoader } from "./components/brand";
import { CallProvider } from "./components/call";
import { ConfettiHost } from "./components/motion";
import { Shell } from "./layouts/Shell";
import { useAuth } from "./lib/auth";
import { LiveProvider } from "./lib/live";
import Login from "./pages/Login";

const Welcome = lazy(() => import("./pages/Welcome"));
const Profile = lazy(() => import("./pages/Profile"));
const PhoneLink = lazy(() => import("./pages/phone/PhoneLink"));
const MyDay = lazy(() => import("./pages/sales/MyDay"));
const Prospects = lazy(() => import("./pages/shared/Prospects"));
const Pipeline = lazy(() => import("./pages/shared/Pipeline"));
const ContactDetail = lazy(() => import("./pages/shared/ContactDetail"));
const Calls = lazy(() => import("./pages/shared/Calls"));
const CallDetail = lazy(() => import("./pages/shared/CallDetail"));
const Tasks = lazy(() => import("./pages/shared/Tasks"));
const Coaching = lazy(() => import("./pages/shared/Coaching"));
const Team = lazy(() => import("./pages/shared/Team"));
const Reports = lazy(() => import("./pages/shared/Reports"));
const ReportDetail = lazy(() => import("./pages/shared/ReportDetail"));
const Intelligence = lazy(() => import("./pages/shared/Intelligence"));
const Allocation = lazy(() => import("./pages/shared/Allocation"));
const Command = lazy(() => import("./pages/founder/Command"));
const People = lazy(() => import("./pages/founder/People"));
const Settings = lazy(() => import("./pages/founder/Settings"));
const Audit = lazy(() => import("./pages/founder/Audit"));
const LegionHome = lazy(() => import("./pages/legion/LegionHome"));
const Handoffs = lazy(() => import("./pages/legion/Handoffs"));
const Meetings = lazy(() => import("./pages/legion/Meetings"));

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
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
