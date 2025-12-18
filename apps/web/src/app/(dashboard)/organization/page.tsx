"use client";

import { useState, useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import { useTranslations } from "next-intl";
import { Button } from "@giga-pdf/ui";
import { Input } from "@giga-pdf/ui";
import { Label } from "@giga-pdf/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@giga-pdf/ui";
import { Badge } from "@giga-pdf/ui";
import { Progress } from "@giga-pdf/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@giga-pdf/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@giga-pdf/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@giga-pdf/ui";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@giga-pdf/ui";
import {
  Building2,
  Users,
  HardDrive,
  FileText,
  Mail,
  UserPlus,
  Trash2,
  Loader2,
  Crown,
  Shield,
  User,
  Eye,
  Settings,
} from "lucide-react";
import {
  api,
  Organization,
  OrganizationMember,
  OrganizationInvitation,
  CreateOrganizationRequest,
} from "@/lib/api";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function getRoleIcon(role: string) {
  switch (role) {
    case "owner":
      return <Crown className="h-4 w-4 text-yellow-500" />;
    case "admin":
      return <Shield className="h-4 w-4 text-blue-500" />;
    case "manager":
      return <Settings className="h-4 w-4 text-green-500" />;
    case "member":
      return <User className="h-4 w-4 text-gray-500" />;
    case "viewer":
      return <Eye className="h-4 w-4 text-gray-400" />;
    default:
      return <User className="h-4 w-4" />;
  }
}

export default function OrganizationPage() {
  const t = useTranslations("organization");
  const tCommon = useTranslations("common");
  const { data: session, isPending: sessionLoading } = useSession();

  // State
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create organization modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm, setCreateForm] = useState<CreateOrganizationRequest>({
    name: "",
    slug: "",
    email: "",
    description: "",
  });

  // Invite member modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");

  // Load organization data
  useEffect(() => {
    const loadOrganization = async () => {
      if (!session?.user?.id) return;

      try {
        setLoading(true);
        setError(null);

        // Get user's organizations
        const memberships = await api.getMyOrganizations(session.user.id);

        const firstMembership = memberships[0];
        if (firstMembership) {
          // Load first organization (user's primary org)
          const org = await api.getOrganization(firstMembership.tenant_id);
          setOrganization(org);

          // Load members
          const membersList = await api.getOrganizationMembers(org.id);
          setMembers(membersList);

          // Load invitations
          const invitationsList = await api.getOrganizationInvitations(org.id);
          setInvitations(invitationsList);
        }
      } catch (err) {
        console.error("Failed to load organization:", err);
        // No organization found - that's ok
      } finally {
        setLoading(false);
      }
    };

    loadOrganization();
  }, [session?.user?.id]);

  // Create organization
  const handleCreateOrganization = async () => {
    if (!createForm.name || !createForm.email) {
      setError(t("errors.requiredFields"));
      return;
    }

    try {
      setCreateLoading(true);
      setError(null);

      // Generate slug from name
      const slug = createForm.slug || createForm.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const org = await api.createOrganization({
        ...createForm,
        slug,
      });

      setOrganization(org);
      setShowCreateModal(false);
      setCreateForm({ name: "", slug: "", email: "", description: "" });

      // Reload members
      const membersList = await api.getOrganizationMembers(org.id);
      setMembers(membersList);
    } catch (err) {
      console.error("Failed to create organization:", err);
      setError(err instanceof Error ? err.message : t("errors.createFailed"));
    } finally {
      setCreateLoading(false);
    }
  };

  // Invite member
  const handleInviteMember = async () => {
    if (!organization || !inviteEmail) return;

    try {
      setInviteLoading(true);
      setError(null);

      await api.inviteMember(organization.id, inviteEmail, inviteRole);

      // Reload invitations
      const invitationsList = await api.getOrganizationInvitations(organization.id);
      setInvitations(invitationsList);

      setShowInviteModal(false);
      setInviteEmail("");
      setInviteRole("member");
    } catch (err) {
      console.error("Failed to invite member:", err);
      setError(err instanceof Error ? err.message : t("errors.inviteFailed"));
    } finally {
      setInviteLoading(false);
    }
  };

  // Cancel invitation
  const handleCancelInvitation = async (invitationId: string) => {
    if (!organization) return;

    try {
      await api.cancelInvitation(organization.id, invitationId);
      setInvitations(invitations.filter(inv => inv.id !== invitationId));
    } catch (err) {
      console.error("Failed to cancel invitation:", err);
    }
  };

  // Remove member
  const handleRemoveMember = async (memberId: string) => {
    if (!organization) return;

    try {
      await api.removeMember(organization.id, memberId);
      setMembers(members.filter(m => m.id !== memberId));
    } catch (err) {
      console.error("Failed to remove member:", err);
    }
  };

  if (sessionLoading || loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No organization - show create prompt
  if (!organization) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>

        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {t("create.title")}
            </CardTitle>
            <CardDescription>{t("create.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("create.benefits")}
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
              <li>{t("create.benefit1")}</li>
              <li>{t("create.benefit2")}</li>
              <li>{t("create.benefit3")}</li>
            </ul>
            <Button onClick={() => setShowCreateModal(true)}>
              <Building2 className="mr-2 h-4 w-4" />
              {t("create.button")}
            </Button>
          </CardContent>
        </Card>

        {/* Create Organization Modal */}
        <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{t("create.modalTitle")}</DialogTitle>
              <DialogDescription>{t("create.modalDescription")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="org-name">{t("fields.name")} *</Label>
                <Input
                  id="org-name"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder={t("fields.namePlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-email">{t("fields.email")} *</Label>
                <Input
                  id="org-email"
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  placeholder={t("fields.emailPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-description">{t("fields.description")}</Label>
                <Input
                  id="org-description"
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder={t("fields.descriptionPlaceholder")}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateModal(false)}>
                {tCommon("cancel")}
              </Button>
              <Button onClick={handleCreateOrganization} disabled={createLoading}>
                {createLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {tCommon("loading")}
                  </>
                ) : (
                  t("create.button")
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Has organization - show dashboard
  const storagePercentage = organization.storage_limit_bytes > 0
    ? (organization.storage_used_bytes / organization.storage_limit_bytes) * 100
    : 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{organization.name}</h1>
          <p className="text-muted-foreground">{organization.description || t("noDescription")}</p>
        </div>
        <Badge variant={organization.status === "active" ? "default" : "secondary"}>
          {organization.status}
        </Badge>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("stats.members")}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {members.length} / {organization.max_members}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("stats.storage")}</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatBytes(organization.storage_used_bytes)}
            </div>
            <Progress value={storagePercentage} className="mt-2" />
            <p className="text-xs text-muted-foreground mt-1">
              {formatBytes(organization.storage_limit_bytes)} {t("stats.total")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("stats.documents")}</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {organization.document_count}
            </div>
            <p className="text-xs text-muted-foreground">
              {organization.document_limit === -1 ? t("stats.unlimited") : `/ ${organization.document_limit}`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("stats.apiCalls")}</CardTitle>
            <Settings className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {organization.api_calls_used.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              / {organization.api_calls_limit.toLocaleString()} {t("stats.perMonth")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="members" className="space-y-4">
        <TabsList>
          <TabsTrigger value="members">
            <Users className="mr-2 h-4 w-4" />
            {t("tabs.members")}
          </TabsTrigger>
          <TabsTrigger value="invitations">
            <Mail className="mr-2 h-4 w-4" />
            {t("tabs.invitations")}
            {invitations.filter(i => !i.is_accepted).length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {invitations.filter(i => !i.is_accepted).length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Members Tab */}
        <TabsContent value="members">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{t("members.title")}</CardTitle>
                <CardDescription>{t("members.description")}</CardDescription>
              </div>
              <Button onClick={() => setShowInviteModal(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                {t("members.invite")}
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("members.email")}</TableHead>
                    <TableHead>{t("members.role")}</TableHead>
                    <TableHead>{t("members.joined")}</TableHead>
                    <TableHead className="text-right">{t("members.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">
                        {member.email || member.user_id}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getRoleIcon(member.role)}
                          <span className="capitalize">{member.role}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {new Date(member.joined_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {member.role !== "owner" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveMember(member.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Invitations Tab */}
        <TabsContent value="invitations">
          <Card>
            <CardHeader>
              <CardTitle>{t("invitations.title")}</CardTitle>
              <CardDescription>{t("invitations.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              {invitations.filter(i => !i.is_accepted).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {t("invitations.empty")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("invitations.email")}</TableHead>
                      <TableHead>{t("invitations.role")}</TableHead>
                      <TableHead>{t("invitations.expires")}</TableHead>
                      <TableHead className="text-right">{t("invitations.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invitations.filter(i => !i.is_accepted).map((invitation) => (
                      <TableRow key={invitation.id}>
                        <TableCell className="font-medium">{invitation.email}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getRoleIcon(invitation.role)}
                            <span className="capitalize">{invitation.role}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {new Date(invitation.expires_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCancelInvitation(invitation.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Invite Member Modal */}
      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("invite.title")}</DialogTitle>
            <DialogDescription>{t("invite.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t("invite.email")}</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t("invite.emailPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">{t("invite.role")}</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t("roles.admin")}</SelectItem>
                  <SelectItem value="manager">{t("roles.manager")}</SelectItem>
                  <SelectItem value="member">{t("roles.member")}</SelectItem>
                  <SelectItem value="viewer">{t("roles.viewer")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteModal(false)}>
              {tCommon("cancel")}
            </Button>
            <Button onClick={handleInviteMember} disabled={inviteLoading || !inviteEmail}>
              {inviteLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {tCommon("loading")}
                </>
              ) : (
                <>
                  <UserPlus className="mr-2 h-4 w-4" />
                  {t("invite.button")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
