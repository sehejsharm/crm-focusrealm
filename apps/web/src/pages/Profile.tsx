import { useMutation } from "@tanstack/react-query";
import { Phone, Smartphone } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../components/toast";
import { Avatar, Button, Card, Field, Input, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ROLE_LABEL } from "../lib/format";
import type { User } from "../lib/types";

export default function Profile() {
  const { user, setUser, meta } = useAuth();
  const toast = useToast();
  const [phone, setPhone] = useState(user?.phone ?? "");
  const save = useMutation({
    mutationFn: () => api.patch<{ user: User }>("/auth/profile", { phone }),
    onSuccess: (r) => {
      setUser(r.user);
      toast({ kind: "success", title: "Profile saved" });
    },
  });
  if (!user) return null;
  return (
    <div className="max-w-2xl">
      <PageHeader title="My profile" subtitle="Your phone number is where calls ring when bridge calling is on." />
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <Avatar name={user.full_name} hue={user.avatar_hue} size={64} />
          <div>
            <p className="text-lg font-bold text-fg">{user.full_name}</p>
            <p className="text-sm text-muted">{user.employee_code} · {user.title ?? ROLE_LABEL[user.role]}</p>
          </div>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="My phone number" hint="The number the CRM rings for bridge calls (with country code).">
            <Input icon={<Phone className="size-4" />} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
          </Field>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>Save</Button>
        </div>
      </Card>
      <Card className="mt-4 p-6" delay={0.1}>
        <div className="flex items-start gap-4">
          <span className="grid size-11 place-items-center rounded-2xl bg-accent-soft text-accent-soft-fg"><Smartphone className="size-5" /></span>
          <div className="flex-1">
            <p className="font-semibold text-fg">Phone Link</p>
            <p className="mt-1 text-sm text-muted">
              Open <b>{location.origin}/phone</b> on your mobile and sign in. When you press Call in the CRM, the number appears on your phone — tap to dial, then attach the recording. Add it to your home screen for one-tap access.
            </p>
            <p className="mt-2 text-xs text-subtle">Calling mode right now: <b>{meta?.telephonyMode === "bridge" ? "Bridge (auto-recorded)" : meta?.telephonyMode === "demo" ? "Demo" : "Phone Link"}</b></p>
            <Link to="/phone" className="mt-3 inline-block text-sm font-semibold text-accent hover:underline">Open Phone Link here →</Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
