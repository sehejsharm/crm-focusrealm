import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  Bell, BrainCircuit, CalendarCheck, ChartNoAxesCombined, ClipboardList, Contact, Crown, Database, FileText, Gauge, Handshake,
  KanbanSquare, LayoutDashboard, ListTodo, LogOut, Menu, Mic, Moon, PhoneCall, ScrollText, Search, Settings, Shield, Shuffle,
  Smartphone, Sparkles, Sun, Swords, Target, Users, X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate, useOutlet } from "react-router-dom";
import { BrandTile } from "../components/brand";
import { CommandPalette } from "../components/command";
import { Beam } from "../components/motion";
import { Avatar, Kbd, Popover } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ago, cn, ROLE_LABEL } from "../lib/format";
import { useLiveStatus } from "../lib/live";
import { useTheme } from "../lib/theme";
import type { Notification, Role } from "../lib/types";

export interface NavItem {
  to: string;
  label: string;
  icon: typeof Gauge;
  end?: boolean;
  section?: string;
}

export function navFor(role: Role): { portal: string; title: string; items: NavItem[] } {
  if (role === "founder") {
    return {
      portal: "founder",
      title: "Founder's Console",
      items: [
        { to: "/founder", label: "Command Center", icon: Crown, end: true, section: "Overview" },
        { to: "/founder/pipeline", label: "Pipeline", icon: KanbanSquare },
        { to: "/founder/team", label: "Team Pulse", icon: Users },
        { to: "/founder/intelligence", label: "Call Intelligence", icon: BrainCircuit },
        { to: "/founder/reports", label: "Daily Reports", icon: FileText },
        { to: "/founder/calls", label: "All Calls", icon: PhoneCall, section: "Operate" },
        { to: "/founder/database", label: "Database & Import", icon: Database },
        { to: "/founder/allocation", label: "Allocation", icon: Shuffle },
        { to: "/founder/tasks", label: "Assign Tasks", icon: ListTodo },
        { to: "/founder/legion", label: "Legion", icon: Swords },
        { to: "/founder/people", label: "People & Access", icon: Shield, section: "Admin" },
        { to: "/founder/settings", label: "Settings", icon: Settings },
        { to: "/founder/audit", label: "Audit Log", icon: ScrollText },
      ],
    };
  }
  if (role === "legion") {
    return {
      portal: "legion",
      title: "Legion Portal",
      items: [
        { to: "/legion", label: "Legion HQ", icon: LayoutDashboard, end: true, section: "Legion" },
        { to: "/legion/handoffs", label: "Handoff Inbox", icon: Handshake },
        { to: "/legion/meetings", label: "Meetings", icon: CalendarCheck },
        { to: "/legion/pipeline", label: "Pipeline", icon: KanbanSquare },
        { to: "/legion/team", label: "Sales Team Work", icon: Users, section: "Sales team" },
        { to: "/legion/calls", label: "Calls", icon: PhoneCall },
        { to: "/legion/reports", label: "Daily Reports", icon: FileText },
        { to: "/legion/tasks", label: "Tasks", icon: ListTodo },
      ],
    };
  }
  const items: NavItem[] = [
    { to: "/sales", label: "My Day", icon: Target, end: true, section: "Sales" },
    { to: "/sales/prospects", label: "My Prospects", icon: Contact },
    { to: "/sales/pipeline", label: "Pipeline", icon: KanbanSquare },
    { to: "/sales/follow-ups", label: "Follow-ups", icon: ClipboardList },
    { to: "/sales/calls", label: "My Calls", icon: PhoneCall },
    { to: "/sales/recordings", label: "Upload Recordings", icon: Mic },
    { to: "/sales/coaching", label: "AI Coaching", icon: Sparkles },
  ];
  if (role === "sales_head") {
    items.push(
      { to: "/sales/team", label: "Team Pulse", icon: Users, section: "Team lead" },
      { to: "/sales/allocation", label: "Allocation", icon: Shuffle },
      { to: "/sales/database", label: "Database & Import", icon: Database },
      { to: "/sales/intelligence", label: "Call Intelligence", icon: ChartNoAxesCombined },
      { to: "/sales/reports", label: "Daily Reports", icon: FileText },
      { to: "/sales/tasks", label: "Team Tasks", icon: ListTodo },
    );
  }
  return { portal: "sales", title: "Sales Team Portal", items };
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={(e) => toggle({ clientX: e.clientX, clientY: e.clientY })}
      className="relative grid size-9 place-items-center overflow-hidden rounded-xl text-muted transition hover:bg-surface-hover hover:text-fg"
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Light theme" : "Dark theme"}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme} initial={{ y: 20, rotate: -90, opacity: 0 }} animate={{ y: 0, rotate: 0, opacity: 1 }} exit={{ y: -20, rotate: 90, opacity: 0 }} transition={{ duration: 0.3 }}>
          {theme === "dark" ? <Moon className="size-4.5" /> : <Sun className="size-4.5" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<{ notifications: Notification[]; unread: number }>("/notifications"), refetchInterval: 60_000 });
  const read = useMutation({ mutationFn: () => api.post("/notifications/read"), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const unread = q.data?.unread ?? 0;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative grid size-9 place-items-center rounded-xl text-muted transition hover:bg-surface-hover hover:text-fg" aria-label="Notifications">
        <motion.span animate={unread ? { rotate: [0, -14, 12, -8, 6, 0] } : {}} transition={{ duration: 0.8, repeat: unread ? Infinity : 0, repeatDelay: 6 }}>
          <Bell className="size-4.5" />
        </motion.span>
        <AnimatePresence>
          {unread > 0 && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-surface">
              {unread > 9 ? "9+" : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-[min(92vw,380px)]">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-sm font-bold text-fg">Notifications</p>
          {unread > 0 && <button onClick={() => read.mutate()} className="text-xs font-semibold text-accent hover:underline">Mark all read</button>}
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-1.5">
          {(q.data?.notifications ?? []).length === 0 && <p className="px-3 py-8 text-center text-sm text-muted">You're all caught up ✨</p>}
          {(q.data?.notifications ?? []).map((n, i) => (
            <motion.button
              key={n.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
              onClick={() => {
                setOpen(false);
                if (n.link) navigate(n.link);
              }}
              className="flex w-full gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-surface-hover"
            >
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-brand-500")} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-fg">{n.title}</span>
                {n.body && <span className="line-clamp-2 block text-xs text-muted">{n.body}</span>}
                <span className="mt-0.5 block text-[11px] text-subtle">{ago(n.created_at)}</span>
              </span>
            </motion.button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-xl p-1 pr-2 transition hover:bg-surface-hover">
        <Avatar name={user.full_name} hue={user.avatar_hue} size={32} />
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-[13px] font-semibold text-fg">{user.full_name.split(" ")[0]}</span>
          <span className="block text-[11px] text-muted">{ROLE_LABEL[user.role]}</span>
        </span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-64 p-1.5">
        <div className="px-3 py-2.5">
          <p className="text-sm font-bold text-fg">{user.full_name}</p>
          <p className="text-xs text-muted">{user.employee_code} · {user.title ?? ROLE_LABEL[user.role]}</p>
        </div>
        <div className="my-1 h-px bg-line" />
        <MenuItem icon={<Smartphone className="size-4" />} onClick={() => { setOpen(false); navigate("/phone"); }}>Open Phone Link</MenuItem>
        <MenuItem icon={<Settings className="size-4" />} onClick={() => { setOpen(false); navigate("/profile"); }}>My profile & phone</MenuItem>
        <MenuItem icon={<LogOut className="size-4" />} onClick={async () => { await logout(); navigate("/login"); }}>Sign out</MenuItem>
      </Popover>
    </div>
  );
}

function MenuItem({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] font-medium text-fg transition hover:bg-surface-hover">
      <span className="text-muted">{icon}</span>
      {children}
    </button>
  );
}

function SideNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <nav className="space-y-0.5">
      {items.map((it, i) => (
        <div key={it.to}>
          {it.section && <p className={cn("px-3 pb-1.5 text-[10.5px] font-bold tracking-[0.14em] text-subtle uppercase", i > 0 && "pt-5")}>{it.section}</p>}
          <NavLink to={it.to} end={it.end} onClick={onNavigate} className="group relative block">
            {({ isActive }) => (
              <motion.span
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.03 * i, ease: [0.16, 1, 0.3, 1], duration: 0.5 }}
                className={cn("relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-semibold transition-colors", isActive ? "text-white" : "text-muted hover:text-fg")}
              >
                {isActive && (
                  <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 shadow-brand" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
                )}
                {!isActive && <span className="absolute inset-0 rounded-xl bg-surface-hover opacity-0 transition-opacity group-hover:opacity-100" />}
                <it.icon className={cn("relative size-[18px] transition-transform group-hover:scale-110", isActive && "drop-shadow")} />
                <span className="relative">{it.label}</span>
              </motion.span>
            )}
          </NavLink>
        </div>
      ))}
    </nav>
  );
}

export function Shell() {
  const { user } = useAuth();
  const location = useLocation();
  const [cmd, setCmd] = useState(false);
  const [mobile, setMobile] = useState(false);
  const live = useLiveStatus();
  const outlet = useOutlet();
  const nav = navFor(user!.role);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmd((c) => !c);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  useEffect(() => setMobile(false), [location.pathname]);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 pt-5 pb-6">
        <BrandTile size={38} />
        <div className="leading-tight">
          <p className="text-[15px] font-bold tracking-tight text-fg">Focus Realm</p>
          <p className="text-[10.5px] font-bold tracking-[0.16em] text-accent uppercase">{nav.title}</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <SideNav items={nav.items} onNavigate={() => setMobile(false)} />
      </div>
      <div className="m-3 overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-brand-50 to-surface p-3.5 dark:from-brand-950/60 dark:to-surface">
        <div className="flex items-center gap-2 text-xs font-semibold text-fg">
          <Smartphone className="size-4 text-accent" /> Phone Link
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted">Open <b>/phone</b> on your mobile — numbers you call appear there to dial and record.</p>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-dvh bg-bg">
      <div className="pointer-events-none fixed inset-0 grid-bg grid-fade opacity-70" />
      <div className="pointer-events-none fixed -top-40 left-1/3 h-80 w-[50rem] rounded-full bg-brand-400/10 blur-[120px] dark:bg-brand-500/10" />

      <aside className="glass fixed inset-y-0 left-0 z-40 hidden w-[264px] border-r border-line lg:block">{sidebar}</aside>

      <AnimatePresence>
        {mobile && (
          <motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-[rgba(10,20,38,0.4)] backdrop-blur-sm" onClick={() => setMobile(false)} />
            <motion.aside initial={{ x: -290 }} animate={{ x: 0 }} exit={{ x: -290 }} transition={{ type: "spring", stiffness: 380, damping: 36 }} className="absolute inset-y-0 left-0 w-[276px] border-r border-line bg-surface">
              <button onClick={() => setMobile(false)} className="absolute top-5 right-3 rounded-lg p-1.5 text-muted hover:bg-surface-hover" aria-label="Close menu">
                <X className="size-5" />
              </button>
              {sidebar}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative lg:pl-[264px]">
        <header className="glass sticky top-0 z-30 border-b border-line">
          <Beam />
          <div className="flex h-15 items-center gap-2 px-4 sm:px-6">
            <button onClick={() => setMobile(true)} className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface-hover lg:hidden" aria-label="Open menu">
              <Menu className="size-5" />
            </button>
            <button
              onClick={() => setCmd(true)}
              className="group flex h-9.5 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-line bg-surface/80 px-3 text-left text-sm text-subtle shadow-xs transition hover:border-line-strong sm:max-w-md"
            >
              <Search className="size-4 shrink-0 transition-transform group-hover:scale-110 group-hover:text-accent" />
              <span className="truncate">Search prospects, calls, people…</span>
              <span className="ml-auto hidden sm:block"><Kbd>⌘ K</Kbd></span>
            </button>
            <div className="ml-auto flex items-center gap-1">
              <span className={cn("mr-2 hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:flex", live ? "bg-success-soft text-success" : "bg-sunken text-subtle")} title={live ? "Live updates on" : "Reconnecting…"}>
                <span className="relative flex size-1.5">
                  {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />}
                  <span className="relative inline-flex size-1.5 rounded-full bg-current" />
                </span>
                {live ? "Live" : "Offline"}
              </span>
              <ThemeToggle />
              <Notifications />
              <UserMenu />
            </div>
          </div>
        </header>

        <main className="relative mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(4px)", transition: { duration: 0.15 } }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <CommandPalette open={cmd} onClose={() => setCmd(false)} nav={nav.items} />
    </div>
  );
}
