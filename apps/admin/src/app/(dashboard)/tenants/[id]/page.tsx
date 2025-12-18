"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@giga-pdf/ui";
import { formatDate } from "@/lib/utils";
import {
  ArrowLeft,
  Users,
  FileText,
  HardDrive,
  Mail,
  Globe,
  Phone,
  Loader2,
  AlertCircle,
  UserPlus,
  Trash2,
  Shield,
  Clock,
} from "lucide-react";
import Link from "next/link";
import {
  tenantsApi,
  type Tenant,
  type TenantMember,
  type TenantDocument,
  type TenantInvitation,
} from "@/lib/api";

const roleColors: Record<string, string> = {
  owner: "bg-purple-100 text-purple-800",
  admin: "bg-blue-100 text-blue-800",
  manager: "bg-green-100 text-green-800",
  member: "bg-gray-100 text-gray-800",
  viewer: "bg-yellow-100 text-yellow-800",
};

export default function TenantDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params.id as string;

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [documents, setDocuments] = useState<TenantDocument[]>([]);
  const [invitations, setInvitations] = useState<TenantInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"members" | "documents" | "invitations" | "settings">("members");

  const fetchTenantData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [tenantData, membersData, documentsData, invitationsData] = await Promise.all([
        tenantsApi.get(tenantId),
        tenantsApi.listMembers(tenantId),
        tenantsApi.listDocuments(tenantId),
        tenantsApi.listInvitations(tenantId),
      ]);

      setTenant(tenantData);
      setMembers(membersData.members);
      setDocuments(documentsData.documents);
      setInvitations(invitationsData.invitations);
    } catch (err) {
      console.error("Failed to fetch tenant:", err);
      setError(err instanceof Error ? err.message : "Failed to load tenant");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchTenantData();
  }, [fetchTenantData]);

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm("Are you sure you want to remove this member?")) return;
    try {
      await tenantsApi.removeMember(tenantId, memberId);
      setMembers(members.filter((m) => m.id !== memberId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    if (!confirm("Are you sure you want to cancel this invitation?")) return;
    try {
      await tenantsApi.cancelInvitation(tenantId, invitationId);
      setInvitations(invitations.filter((i) => i.id !== invitationId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to cancel invitation");
    }
  };

  const handleUnshareDocument = async (documentId: string) => {
    if (!confirm("Are you sure you want to remove this document from the organization?")) return;
    try {
      await tenantsApi.unshareDocument(tenantId, documentId);
      setDocuments(documents.filter((d) => d.document_id !== documentId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove document");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !tenant) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-destructive">{error || "Tenant not found"}</p>
        <button
          onClick={() => router.push("/tenants")}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          Back to Tenants
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/tenants"
          className="rounded-md p-2 hover:bg-accent"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{tenant.name}</h1>
            <Badge
              variant={
                tenant.status === "active"
                  ? "default"
                  : tenant.status === "trial"
                  ? "secondary"
                  : "destructive"
              }
            >
              {tenant.status}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            <code className="text-sm bg-muted px-1 py-0.5 rounded">{tenant.slug}</code>
          </p>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Users className="h-4 w-4" />
            <span className="text-sm">Members</span>
          </div>
          <div className="text-2xl font-bold mt-1">
            {tenant.member_count}
            <span className="text-sm font-normal text-muted-foreground"> / {tenant.max_members}</span>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileText className="h-4 w-4" />
            <span className="text-sm">Documents</span>
          </div>
          <div className="text-2xl font-bold mt-1">{tenant.document_count}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <HardDrive className="h-4 w-4" />
            <span className="text-sm">Storage Used</span>
          </div>
          <div className="text-2xl font-bold mt-1">{tenant.storage_used_formatted}</div>
          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden mt-2">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.min(tenant.storage_percentage, 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            of {tenant.storage_limit_formatted}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span className="text-sm">Created</span>
          </div>
          <div className="text-lg font-medium mt-1">{formatDate(tenant.created_at)}</div>
        </div>
      </div>

      {/* Contact Info */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="font-semibold mb-3">Contact Information</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span>{tenant.email}</span>
          </div>
          {tenant.phone && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{tenant.phone}</span>
            </div>
          )}
          {tenant.website && (
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <a href={tenant.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {tenant.website}
              </a>
            </div>
          )}
        </div>
        {tenant.description && (
          <p className="text-muted-foreground mt-3">{tenant.description}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b">
        <nav className="flex gap-4">
          {(["members", "documents", "invitations", "settings"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-2 px-1 border-b-2 font-medium text-sm capitalize ${
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
              {tab === "members" && ` (${members.length})`}
              {tab === "documents" && ` (${documents.length})`}
              {tab === "invitations" && invitations.length > 0 && ` (${invitations.length})`}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-4">
        {/* Members Tab */}
        {activeTab === "members" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold">Team Members</h3>
              <button className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 flex items-center gap-1">
                <UserPlus className="h-4 w-4" />
                Add Member
              </button>
            </div>
            {members.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No members yet. Add your first team member.
              </div>
            ) : (
              <div className="rounded-lg border">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium">User</th>
                      <th className="text-left p-3 font-medium">Role</th>
                      <th className="text-left p-3 font-medium">Status</th>
                      <th className="text-left p-3 font-medium">Joined</th>
                      <th className="text-left p-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.id} className="border-t">
                        <td className="p-3">
                          <div className="font-medium">{member.user_email || "Unknown"}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {member.user_id.slice(0, 8)}...
                          </div>
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${roleColors[member.role] || "bg-gray-100"}`}>
                            {member.role}
                          </span>
                        </td>
                        <td className="p-3">
                          <Badge variant={member.is_active ? "default" : "secondary"}>
                            {member.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="p-3 text-sm text-muted-foreground">
                          {formatDate(member.joined_at)}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <button className="p-1 hover:bg-accent rounded" title="Edit role">
                              <Shield className="h-4 w-4" />
                            </button>
                            {member.role !== "owner" && (
                              <button
                                onClick={() => handleRemoveMember(member.id)}
                                className="p-1 hover:bg-accent rounded"
                                title="Remove"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Documents Tab */}
        {activeTab === "documents" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold">Shared Documents</h3>
            </div>
            {documents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No documents shared with this organization yet.
              </div>
            ) : (
              <div className="rounded-lg border">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium">Document</th>
                      <th className="text-left p-3 font-medium">Access Level</th>
                      <th className="text-left p-3 font-medium">Shared By</th>
                      <th className="text-left p-3 font-medium">Added</th>
                      <th className="text-left p-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc) => (
                      <tr key={doc.id} className="border-t">
                        <td className="p-3">
                          <div className="font-medium">{doc.document_name}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {doc.document_id.slice(0, 8)}...
                          </div>
                        </td>
                        <td className="p-3">
                          <Badge variant={doc.access_level === "admin" ? "default" : "secondary"}>
                            {doc.access_level}
                          </Badge>
                        </td>
                        <td className="p-3 text-sm">
                          {doc.added_by_email || "Unknown"}
                        </td>
                        <td className="p-3 text-sm text-muted-foreground">
                          {formatDate(doc.added_at)}
                        </td>
                        <td className="p-3">
                          <button
                            onClick={() => handleUnshareDocument(doc.document_id)}
                            className="p-1 hover:bg-accent rounded"
                            title="Remove from organization"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Invitations Tab */}
        {activeTab === "invitations" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold">Pending Invitations</h3>
              <button className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 flex items-center gap-1">
                <Mail className="h-4 w-4" />
                Send Invitation
              </button>
            </div>
            {invitations.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No pending invitations.
              </div>
            ) : (
              <div className="rounded-lg border">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium">Email</th>
                      <th className="text-left p-3 font-medium">Role</th>
                      <th className="text-left p-3 font-medium">Status</th>
                      <th className="text-left p-3 font-medium">Expires</th>
                      <th className="text-left p-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invitations.map((invitation) => (
                      <tr key={invitation.id} className="border-t">
                        <td className="p-3 font-medium">{invitation.email}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${roleColors[invitation.role] || "bg-gray-100"}`}>
                            {invitation.role}
                          </span>
                        </td>
                        <td className="p-3">
                          {invitation.is_expired ? (
                            <Badge variant="destructive">Expired</Badge>
                          ) : invitation.is_accepted ? (
                            <Badge variant="default">Accepted</Badge>
                          ) : (
                            <Badge variant="secondary">Pending</Badge>
                          )}
                        </td>
                        <td className="p-3 text-sm text-muted-foreground">
                          {formatDate(invitation.expires_at)}
                        </td>
                        <td className="p-3">
                          {!invitation.is_accepted && (
                            <button
                              onClick={() => handleCancelInvitation(invitation.id)}
                              className="p-1 hover:bg-accent rounded"
                              title="Cancel invitation"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === "settings" && (
          <div className="space-y-6">
            <div className="rounded-lg border bg-card p-6">
              <h3 className="font-semibold mb-4">Organization Settings</h3>
              <div className="grid gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Allow Member Invites</p>
                    <p className="text-sm text-muted-foreground">
                      Allow existing members to invite new members
                    </p>
                  </div>
                  <input type="checkbox" defaultChecked className="h-4 w-4" />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Require 2FA</p>
                    <p className="text-sm text-muted-foreground">
                      Require two-factor authentication for all members
                    </p>
                  </div>
                  <input type="checkbox" className="h-4 w-4" />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6">
              <h3 className="font-semibold text-destructive mb-2">Danger Zone</h3>
              <p className="text-sm text-muted-foreground mb-4">
                These actions are irreversible. Please proceed with caution.
              </p>
              <div className="flex gap-2">
                <button className="rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10">
                  Suspend Organization
                </button>
                <button className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90">
                  Delete Organization
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
