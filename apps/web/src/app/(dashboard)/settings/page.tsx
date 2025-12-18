"use client";

import { useState } from "react";
import { useSession, updateUser, changePassword } from "@/lib/auth-client";
import { useTranslations } from "next-intl";
import { Button } from "@giga-pdf/ui";
import { Input } from "@giga-pdf/ui";
import { Label } from "@giga-pdf/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@giga-pdf/ui";
import { useTheme } from "next-themes";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@giga-pdf/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@giga-pdf/ui";
import { Loader2 } from "lucide-react";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const { data: session, isPending: sessionLoading } = useSession();
  const { theme, setTheme } = useTheme();

  // Profile state
  const [name, setName] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Delete account state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Initialize name from session
  useState(() => {
    if (session?.user?.name) {
      setName(session.user.name);
    }
  });

  const handleProfileUpdate = async () => {
    if (!name.trim()) {
      setProfileError(t("profile.name") + " " + tCommon("error"));
      return;
    }

    try {
      setProfileLoading(true);
      setProfileError(null);
      setProfileSuccess(false);

      const { error } = await updateUser({
        name: name.trim(),
      });

      if (error) {
        setProfileError(error.message || tCommon("error"));
        return;
      }

      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 3000);
    } catch (err) {
      console.error("Profile update failed:", err);
      setProfileError(err instanceof Error ? err.message : tCommon("error"));
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    // Validation
    if (!currentPassword) {
      setPasswordError(t("security.currentPassword") + " " + tCommon("error"));
      return;
    }
    if (!newPassword) {
      setPasswordError(t("security.newPassword") + " " + tCommon("error"));
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError(t("security.newPassword") + " - min 8 caractères");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("security.confirmPassword") + " " + tCommon("error"));
      return;
    }

    try {
      setPasswordLoading(true);
      setPasswordError(null);
      setPasswordSuccess(false);

      const { error } = await changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });

      if (error) {
        setPasswordError(error.message || tCommon("error"));
        return;
      }

      setPasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err) {
      console.error("Password change failed:", err);
      setPasswordError(err instanceof Error ? err.message : tCommon("error"));
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "DELETE") {
      return;
    }

    try {
      setDeleteLoading(true);
      alert(t("danger.deleteAccountConfirm"));
      setDeleteDialogOpen(false);
    } catch (err) {
      console.error("Delete account failed:", err);
    } finally {
      setDeleteLoading(false);
      setDeleteConfirmation("");
    }
  };

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("profile.description")}
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("profile.title")}</CardTitle>
            <CardDescription>
              {t("profile.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {profileError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                {profileError}
              </div>
            )}
            {profileSuccess && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                {t("profile.saved")}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="name">{t("profile.name")}</Label>
              <Input
                id="name"
                value={name || session?.user?.name || ""}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("profile.name")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t("profile.email")}</Label>
              <Input
                id="email"
                type="email"
                value={session?.user?.email || ""}
                disabled
                className="bg-muted"
              />
            </div>
            <Button onClick={handleProfileUpdate} disabled={profileLoading}>
              {profileLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {tCommon("loading")}
                </>
              ) : (
                t("profile.save")
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("preferences.title")}</CardTitle>
            <CardDescription>
              {t("preferences.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="theme">{t("preferences.theme")}</Label>
              <Select value={theme} onValueChange={setTheme}>
                <SelectTrigger id="theme">
                  <SelectValue placeholder={t("preferences.theme")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">{t("preferences.themeLight")}</SelectItem>
                  <SelectItem value="dark">{t("preferences.themeDark")}</SelectItem>
                  <SelectItem value="system">{t("preferences.themeSystem")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("security.title")}</CardTitle>
            <CardDescription>
              {t("security.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {passwordError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                {passwordError}
              </div>
            )}
            {passwordSuccess && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                {t("profile.saved")}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="current-password">{t("security.currentPassword")}</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">{t("security.newPassword")}</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{t("security.confirmPassword")}</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <Button onClick={handlePasswordChange} disabled={passwordLoading}>
              {passwordLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {tCommon("loading")}
                </>
              ) : (
                t("security.changePassword")
              )}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">{t("danger.title")}</CardTitle>
            <CardDescription>
              {t("danger.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
              {t("danger.deleteAccount")}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("danger.deleteAccount")}</DialogTitle>
            <DialogDescription>
              {t("danger.deleteAccountConfirm")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Tapez <span className="font-mono font-bold">DELETE</span> pour confirmer.
            </p>
            <Input
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              placeholder="DELETE"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setDeleteConfirmation("");
              }}
              disabled={deleteLoading}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={deleteConfirmation !== "DELETE" || deleteLoading}
            >
              {deleteLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {tCommon("loading")}
                </>
              ) : (
                t("danger.deleteAccount")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
