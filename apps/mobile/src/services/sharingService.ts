/**
 * Sharing Service
 * Handles document sharing operations with the API
 */

import { apiClient } from './api';

// ============================================================================
// Types
// ============================================================================

export interface SharedDocument {
  id: string;
  name: string;
  page_count: number;
  file_size_bytes: number;
  thumbnail_path?: string;
  created_at: string;
  updated_at: string;
  share_source: 'direct' | 'organization';
  share_id: string;
  permission: 'view' | 'edit';
  shared_at: string;
  owner: {
    user_id: string;
    email: string;
  };
}

export interface SharedByMeDocument {
  share_id: string;
  document: {
    id: string;
    name: string;
    page_count: number;
    thumbnail_path?: string;
  };
  shared_with: {
    user_id: string;
    email: string;
  };
  is_public_link: boolean;
  permission: 'view' | 'edit';
  created_at: string;
  expires_at?: string;
}

export interface ShareInvitation {
  invitation_id: string;
  token: string;
  document: {
    id: string;
    name: string;
    page_count: number;
    thumbnail_path?: string;
  };
  inviter: {
    user_id: string;
    email: string;
  };
  permission: 'view' | 'edit';
  message?: string;
  created_at: string;
  expires_at: string;
}

export interface DocumentShare {
  share_id?: string;
  invitation_id?: string;
  shared_with?: {
    user_id: string;
    email: string;
  };
  invitee_email?: string;
  is_public_link?: boolean;
  share_token?: string;
  permission: 'view' | 'edit';
  status?: 'pending';
  created_at: string;
  expires_at?: string;
}

export interface ShareNotification {
  id: string;
  type: 'share_invitation' | 'share_accepted' | 'share_declined' | 'share_revoked' | 'permission_changed';
  title: string;
  message?: string;
  document?: {
    id: string;
    name: string;
  };
  metadata?: Record<string, any>;
  is_read: boolean;
  created_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// ============================================================================
// Service
// ============================================================================

export const sharingService = {
  /**
   * Get documents shared with current user
   */
  async getSharedWithMe(params: {
    page?: number;
    per_page?: number;
    source?: 'all' | 'direct' | 'organization';
  } = {}): Promise<PaginatedResponse<SharedDocument>> {
    const { page = 1, per_page = 20, source = 'all' } = params;

    const response = await apiClient.get<{
      documents: SharedDocument[];
      total: number;
      page: number;
      per_page: number;
      total_pages: number;
    }>('/sharing/shared-with-me', {
      params: { page, per_page, source },
    });

    return {
      items: response.data?.documents || [],
      total: response.data?.total || 0,
      page: response.data?.page || 1,
      per_page: response.data?.per_page || 20,
      total_pages: response.data?.total_pages || 0,
    };
  },

  /**
   * Get documents shared by current user
   */
  async getSharedByMe(params: {
    page?: number;
    per_page?: number;
  } = {}): Promise<PaginatedResponse<SharedByMeDocument>> {
    const { page = 1, per_page = 20 } = params;

    const response = await apiClient.get<{
      shares: SharedByMeDocument[];
      total: number;
      page: number;
      per_page: number;
      total_pages: number;
    }>('/sharing/shared-by-me', {
      params: { page, per_page },
    });

    return {
      items: response.data?.shares || [],
      total: response.data?.total || 0,
      page: response.data?.page || 1,
      per_page: response.data?.per_page || 20,
      total_pages: response.data?.total_pages || 0,
    };
  },

  /**
   * Share a document with another user
   */
  async shareDocument(params: {
    document_id: string;
    invitee_email: string;
    permission?: 'view' | 'edit';
    message?: string;
    expires_in_days?: number;
  }): Promise<{
    invitation_id: string;
    token: string;
    invitee_email: string;
    invitee_user_exists: boolean;
    permission: 'view' | 'edit';
    expires_at: string;
    document_name: string;
  }> {
    const response = await apiClient.post('/sharing/share', {
      document_id: params.document_id,
      invitee_email: params.invitee_email,
      permission: params.permission || 'edit',
      message: params.message,
      expires_in_days: params.expires_in_days || 7,
    });

    return response.data;
  },

  /**
   * Get pending invitations
   */
  async getPendingInvitations(): Promise<{
    invitations: ShareInvitation[];
    count: number;
  }> {
    const response = await apiClient.get<{
      invitations: ShareInvitation[];
      count: number;
    }>('/sharing/invitations/pending');

    return {
      invitations: response.data?.invitations || [],
      count: response.data?.count || 0,
    };
  },

  /**
   * Accept a share invitation
   */
  async acceptInvitation(token: string): Promise<{
    share_id: string;
    document_id: string;
    document_name: string;
    permission: 'view' | 'edit';
  }> {
    const response = await apiClient.post(`/sharing/invitations/${token}/accept`);
    return response.data;
  },

  /**
   * Decline a share invitation
   */
  async declineInvitation(token: string): Promise<{
    invitation_id: string;
    status: 'declined';
  }> {
    const response = await apiClient.post(`/sharing/invitations/${token}/decline`);
    return response.data;
  },

  /**
   * Revoke a share
   */
  async revokeShare(shareId: string): Promise<{
    share_id: string;
    status: 'revoked';
  }> {
    const response = await apiClient.delete(`/sharing/shares/${shareId}`);
    return response.data;
  },

  /**
   * Update share permission
   */
  async updateSharePermission(
    shareId: string,
    permission: 'view' | 'edit'
  ): Promise<{
    share_id: string;
    permission: 'view' | 'edit';
    old_permission: 'view' | 'edit';
  }> {
    const response = await apiClient.patch(`/sharing/shares/${shareId}/permission`, {
      permission,
    });
    return response.data;
  },

  /**
   * Get all shares for a document
   */
  async getDocumentShares(documentId: string): Promise<{
    shares: DocumentShare[];
    count: number;
  }> {
    const response = await apiClient.get<{
      shares: DocumentShare[];
      count: number;
    }>(`/sharing/documents/${documentId}/shares`);

    return {
      shares: response.data?.shares || [],
      count: response.data?.count || 0,
    };
  },

  /**
   * Create a public link for a document
   */
  async createPublicLink(
    documentId: string,
    expiresInDays?: number
  ): Promise<{
    share_id: string;
    token: string;
    permission: 'view';
    expires_at?: string;
    already_existed: boolean;
  }> {
    const response = await apiClient.post(`/sharing/documents/${documentId}/public-link`, {
      expires_in_days: expiresInDays,
    });
    return response.data;
  },

  /**
   * Revoke a public link for a document
   */
  async revokePublicLink(documentId: string): Promise<{
    status: 'revoked';
    share_id: string;
  }> {
    const response = await apiClient.delete(`/sharing/documents/${documentId}/public-link`);
    return response.data;
  },

  /**
   * Get notifications
   */
  async getNotifications(params: {
    page?: number;
    per_page?: number;
    unread_only?: boolean;
  } = {}): Promise<PaginatedResponse<ShareNotification>> {
    const { page = 1, per_page = 20, unread_only = false } = params;

    const response = await apiClient.get<{
      notifications: ShareNotification[];
      total: number;
      page: number;
      per_page: number;
      total_pages: number;
    }>('/sharing/notifications', {
      params: { page, per_page, unread_only },
    });

    return {
      items: response.data?.notifications || [],
      total: response.data?.total || 0,
      page: response.data?.page || 1,
      per_page: response.data?.per_page || 20,
      total_pages: response.data?.total_pages || 0,
    };
  },

  /**
   * Get unread notification count
   */
  async getUnreadCount(): Promise<number> {
    const response = await apiClient.get<{ unread_count: number }>(
      '/sharing/notifications/unread-count'
    );
    return response.data?.unread_count || 0;
  },

  /**
   * Mark notification as read
   */
  async markNotificationRead(notificationId: string): Promise<void> {
    await apiClient.post(`/sharing/notifications/${notificationId}/read`);
  },

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsRead(): Promise<number> {
    const response = await apiClient.post<{ marked_count: number }>(
      '/sharing/notifications/read-all'
    );
    return response.data?.marked_count || 0;
  },

  /**
   * Remove a document from "shared with me" list
   */
  async removeFromSharedWithMe(shareId: string): Promise<void> {
    await apiClient.delete(`/sharing/shares/${shareId}`);
  },
};

export default sharingService;
