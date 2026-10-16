import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, BrainCircuit, Crown, Eye, EyeOff, KeyRound, PhoneCall, Sparkles, Swords, TrendingUp, UserRound, Users } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { BrandMark, BrandTile } from "../components/brand";
import { Aurora, Constellation, Counter, Tilt, Typewriter, Waveform } from "../components/motion";
import { useToast } from "../components/toast";
import { Avatar, Button, Input } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cn, ROLE_LABEL } from "../lib/format";
import { useTheme } from "../lib/theme";
import type { User } from "../lib/types";

const PORTALS = [
  { key: "sales", label: "Sales Team", icon: Users, blurb: "Your day, your prospects, one-tap calling and AI coaching after every call." },
  { key: "legion", label: "Legion", icon: Swords, blurb: "Qualified handoffs, Legion meetings and a live view of the sales team's work." },
  { key: "founder", label: "Founders", icon: Crown, blurb: "Everything, everywhere: funnel, people, call intelligence, reports and control." },
] as const;

export default function Login() {
  const { user, meta, setUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { theme, toggle } = useTheme();
  const [portal, setPortal] = useState<(typeof PORTALS)[number]["key"]>("sales");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to={user.must_change_password ? "/welcome" : `/${user.portal}`} replace />;

  const signIn = async (id = login, pw = password) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: User }>("/auth/login", { login: id, password: pw });
      qc.removeQueries({ predicate: (q) => !["me", "meta"].includes(String(q.queryKey[0])) });
      setUser(r.user);
      if (!r.user.must_change_password && r.user.portal !== portal) {
        toast({ kind: "info", title: `Welcome to the ${PORTALS.find((p) => p.key === r.user.portal)?.label} portal`, body: "Your role decides which portal you sign in to." });
      }
      navigate(r.user.must_change_password ? "/welcome" : `/${r.user.portal}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reach the CRM — check your connection");
    } finally {
      setBusy(false);
    }
  };

  const demo = (meta?.demoLogins ?? []).filter((d) =>
    portal === "founder" ? d.role === "founder" : portal === "legion" ? d.role === "legion" : d.role === "sales_rep" || d.role === "sales_head",
  );

  return (
    <div className="relative grid min-h-dvh bg-bg lg:grid-cols-[1.15fr_1fr]">
      {/* ---------------------------------------------------------- hero */}
      <section className="noise relative hidden overflow-hidden bg-gradient-to-br from-[#061a42] via-[#0d3482] to-[#1655c0] text-white lg:sticky lg:top-0 lg:block lg:h-dvh lg:self-start">
        <Aurora intensity={0.9} />
        <Constellation className="opacity-80" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(124,192,250,0.25),transparent_55%)]" />
        <div className="relative flex h-full flex-col justify-between gap-6 p-10 xl:p-14">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-white shadow-lg"><BrandMark size={32} animated /></span>
            <span className="leading-tight">
              <span className="block text-lg font-bold tracking-tight">Focus Realm</span>
              <span className="block text-[11px] font-semibold tracking-[0.2em] text-sky uppercase">Sales CRM · AI Call Intelligence</span>
            </span>
          </motion.div>

          <div className="max-w-xl">
            <motion.h1
              initial="h"
              animate="s"
              variants={{ h: {}, s: { transition: { staggerChildren: 0.08, delayChildren: 0.3 } } }}
              className="text-[52px] leading-[1.02] font-bold tracking-[-0.03em] xl:text-[64px]"
            >
              {["The", "sales", "floor,", "reimagined."].map((w) => (
                <motion.span key={w} variants={{ h: { opacity: 0, y: 40, rotateX: -60, filter: "blur(10px)" }, s: { opacity: 1, y: 0, rotateX: 0, filter: "blur(0px)", transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } } }} className="mr-[0.22em] inline-block">
                  {w === "reimagined." ? <span className="bg-gradient-to-r from-white via-sky to-white bg-[length:200%_100%] bg-clip-text text-transparent animate-gradient">{w}</span> : w}
                </motion.span>
              ))}
            </motion.h1>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-5 h-8 text-xl text-white/80">
              <Typewriter words={["Every call recorded.", "Every call analysed by AI.", "Every rep coached daily.", "Every lead allocated fairly.", "Every report in the founders' inbox."]} />
            </motion.p>
          </div>

          {/* Floating live cards */}
          <div className="relative h-52 shrink-0">
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1, type: "spring" }} className="absolute top-0 left-0 w-64 animate-float">
              <Tilt className="rounded-2xl">
                <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-xl">
                  <div className="flex items-center justify-between text-xs text-white/70"><span className="flex items-center gap-1.5"><PhoneCall className="size-3.5" /> Live call</span><span className="flex items-center gap-1"><span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> 03:42</span></div>
                  <Waveform bars={26} className="mt-2 h-9" />
                  <p className="mt-1 text-sm font-semibold">Discovery going well</p>
                </div>
              </Tilt>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.3, type: "spring" }} className="absolute top-6 left-72 w-56 animate-float [animation-delay:-2s]">
              <Tilt className="rounded-2xl">
                <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-xl">
                  <p className="flex items-center gap-1.5 text-xs text-white/70"><BrainCircuit className="size-3.5" /> AI call score</p>
                  <p className="mt-1 text-4xl font-bold tracking-tight"><Counter value={86} duration={2.2} /><span className="text-lg text-white/60">/100</span></p>
                  <p className="text-xs text-emerald-300">SPIN 8.6 · BANT 9.1 · MEDDIC 7.4</p>
                </div>
              </Tilt>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5, type: "spring" }} className="absolute top-32 left-24 w-60 animate-float [animation-delay:-4s]">
              <Tilt className="rounded-2xl">
                <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 p-3.5 backdrop-blur-xl">
                  <span className="grid size-10 place-items-center rounded-xl bg-emerald-400/20 text-emerald-300"><TrendingUp className="size-5" /></span>
                  <div>
                    <p className="text-sm font-semibold">Legion Meet booked 🚀</p>
                    <p className="text-xs text-white/65">Report emailed to CEO & COO</p>
                  </div>
                </div>
              </Tilt>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- form */}
      <section className="relative flex flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-0 grid-bg grid-fade" />
        <div className="pointer-events-none absolute -top-32 -right-32 size-96 rounded-full bg-brand-400/20 blur-[100px] lg:hidden" />
        <div className="relative flex items-center justify-between p-5 sm:p-8">
          <div className="flex items-center gap-2.5 lg:invisible">
            <BrandTile size={36} animated />
            <span className="text-[15px] font-bold text-fg">Focus Realm</span>
          </div>
          <button onClick={(e) => toggle({ clientX: e.clientX, clientY: e.clientY })} className="rounded-xl px-3 py-1.5 text-xs font-semibold text-muted transition hover:bg-surface-hover hover:text-fg">
            {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>
        </div>

        <div className="relative flex flex-1 items-center justify-center px-5 pb-10 sm:px-8">
          {meta?.setupNeeded ? <FirstFounderSetup enabled={meta.setupEnabled} /> : (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} className="w-full max-w-[420px]">
            <h2 className="text-[30px] font-bold tracking-tight text-fg">Welcome back</h2>
            <p className="mt-1 text-sm text-muted">Sign in with your Focus Realm login ID.</p>

            <div className="mt-7 grid grid-cols-3 gap-1.5 rounded-2xl border border-line bg-sunken p-1.5">
              {PORTALS.map((p) => (
                <button key={p.key} onClick={() => setPortal(p.key)} className={cn("relative flex flex-col items-center gap-1 rounded-xl py-2.5 text-xs font-semibold transition-colors", portal === p.key ? "text-white" : "text-muted hover:text-fg")}>
                  {portal === p.key && <motion.span layoutId="portal-pill" className="absolute inset-0 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-brand" transition={{ type: "spring", stiffness: 460, damping: 34 }} />}
                  <p.icon className="relative size-[18px]" />
                  <span className="relative">{p.label}</span>
                </button>
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.p key={portal} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="mt-3 min-h-10 text-[13px] leading-relaxed text-muted">
                {PORTALS.find((p) => p.key === portal)!.blurb}
              </motion.p>
            </AnimatePresence>

            <form
              className="mt-4 space-y-3.5"
              onSubmit={(e) => {
                e.preventDefault();
                signIn();
              }}
            >
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-fg">{portal === "legion" ? "Legion ID" : "FR number"}</span>
                <Input icon={<UserRound className="size-4" />} value={login} onChange={(e) => setLogin(e.target.value)} placeholder={portal === "legion" ? "LG-0001" : "FR-0042"} autoComplete="username" autoFocus className="h-12 rounded-2xl text-[15px]" />
                <span className="mt-1.5 block text-xs text-muted">{portal === "legion" ? "The LG ID a founder gave you, or your email." : "Your Focus Realm Workspace ID, or your email."}</span>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-fg">Password</span>
                <div className="relative">
                  <Input icon={<KeyRound className="size-4" />} type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" autoComplete="current-password" className="h-12 rounded-2xl pr-11 text-[15px]" />
                  <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-1/2 right-3 -translate-y-1/2 rounded-lg p-1 text-subtle hover:text-fg" aria-label={show ? "Hide password" : "Show password"}>
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </label>
              <AnimatePresence>
                {error && (
                  <motion.p initial={{ opacity: 0, height: 0, x: 0 }} animate={{ opacity: 1, height: "auto", x: [0, -8, 8, -5, 5, 0] }} exit={{ opacity: 0, height: 0 }} className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger">
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
              <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!login || !password}>
                Enter the {PORTALS.find((p) => p.key === portal)!.label} portal <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </form>

            <p className="mt-4 text-center text-xs text-muted">
              {portal === "sales" ? "New to the sales team? Your login arrives from the HR console when you join." : "No login yet? A founder creates it in People & Access and gives you a one-time password."}
            </p>

            {demo.length > 0 && meta?.demoPassword && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mt-7 rounded-2xl border border-dashed border-brand-300 bg-accent-soft/50 p-4 dark:border-brand-800">
                <p className="mb-2.5 flex items-center gap-1.5 text-xs font-bold tracking-wide text-accent-soft-fg uppercase"><Sparkles className="size-3.5" /> Demo accounts — one tap</p>
                <div className="grid gap-1.5">
                  {demo.slice(0, 6).map((d, i) => (
                    <motion.button
                      key={d.employee_code}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.5 + i * 0.05 }}
                      whileHover={{ x: 3 }}
                      onClick={() => {
                        setLogin(d.employee_code);
                        setPassword(meta.demoPassword!);
                        signIn(d.employee_code, meta.demoPassword!);
                      }}
                      className="flex items-center gap-3 rounded-xl bg-surface/80 px-3 py-2 text-left shadow-xs ring-1 ring-line transition hover:ring-brand-300"
                    >
                      <Avatar name={d.full_name} hue={d.avatar_hue} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-fg">{d.full_name}</span>
                        <span className="block truncate text-[11px] text-muted">{d.title ?? ROLE_LABEL[d.role]} · {d.employee_code}</span>
                      </span>
                      <ArrowRight className="size-4 text-subtle" />
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </motion.div>
          )}
        </div>
        <p className="relative pb-5 text-center text-[11px] text-subtle">© Focus Realm · Sales CRM & AI Call Intelligence</p>
      </section>
    </div>
  );
}

/**
 * First run, before any founder exists: the first founder creates their own
 * login with the one-time SETUP_CODE from the CRM's environment variables.
 */
function FirstFounderSetup({ enabled }: { enabled: boolean }) {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState({ code: "", employee_code: "", full_name: "", email: "", title: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === "employee_code" ? e.target.value.toUpperCase() : e.target.value });

  const submit = async () => {
    if (f.password !== f.confirm) return setError("The two passwords don't match");
    setBusy(true);
    setError(null);
    try {
      const { confirm: _c, ...body } = f;
      const r = await api.post<{ user: User }>("/auth/setup", { ...body, email: body.email || null, title: body.title || null });
      qc.invalidateQueries({ queryKey: ["meta"] });
      setUser(r.user);
      navigate("/founder", { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reach the CRM — check your connection");
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, k: keyof typeof f, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-fg">{label}</span>
      <Input value={f[k]} onChange={set(k)} className="h-11 rounded-2xl text-[15px]" {...props} />
    </label>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} className="w-full max-w-[420px]">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent-soft-fg"><Crown className="size-3.5" /> First-time setup</span>
      <h2 className="mt-3 text-[30px] font-bold tracking-tight text-fg">Set up the CRM</h2>
      <p className="mt-1 text-sm text-muted">
        Create the first founder login with your FR number from Workspace. Then add the other founders and Legion in People &amp; Access; the sales team arrives from the HR console.
      </p>
      {!enabled ? (
        <div className="mt-6 rounded-2xl border border-warning/40 bg-warning-soft p-4 text-sm text-fg">
          <p className="font-semibold">Setup is locked</p>
          <p className="mt-1 text-muted">
            Add a <b>SETUP_CODE</b> environment variable to the CRM in Vercel (any long random text), redeploy, then come back here and enter it.
          </p>
        </div>
      ) : (
        <form className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {field("Setup code", "code", { type: "password", autoComplete: "off", placeholder: "SETUP_CODE from Vercel", autoFocus: true })}
          <div className="grid gap-3 sm:grid-cols-2">
            {field("FR number", "employee_code", { placeholder: "FR-0001", autoComplete: "username" })}
            {field("Full name", "full_name", { autoComplete: "name" })}
            {field("Email", "email", { type: "email", autoComplete: "email", placeholder: "Daily reports go here" })}
            {field("Title", "title", { placeholder: "Co-founder & CEO" })}
            {field("Password", "password", { type: "password", autoComplete: "new-password", placeholder: "10+ characters" })}
            {field("Repeat password", "confirm", { type: "password", autoComplete: "new-password" })}
          </div>
          <AnimatePresence>
            {error && (
              <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger">
                {error}
              </motion.p>
            )}
          </AnimatePresence>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!f.code || !f.employee_code || !f.full_name || f.password.length < 10 || !f.confirm}>
            Create founder login <ArrowRight className="size-4" />
          </Button>
        </form>
      )}
    </motion.div>
  );
}
