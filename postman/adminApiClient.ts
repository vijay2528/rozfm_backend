import axios from 'axios';

const ADMIN_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1/admin';

export const adminClient = axios.create({
  baseURL: ADMIN_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

adminClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token') || localStorage.getItem('adminToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// 1. Dashboard Overview
export const getAdminDashboard = () => adminClient.get('/dashboard').then((res) => res.data);

// 2. User Management
export const getAdminUsers = (params?: { search?: string; role?: string; is_blocked?: string; page?: number; limit?: number }) =>
  adminClient.get('/users', { params }).then((res) => res.data);

export const getAdminUserDetail = (id: string | number) =>
  adminClient.get(`/users/${id}`).then((res) => res.data);

export const updateAdminUser = (id: string | number, data: any) =>
  adminClient.put(`/users/${id}`, data).then((res) => res.data);

export const updateAdminUserWallet = (id: string | number, data: { coins: number; type: 'credit' | 'debit'; description?: string }) =>
  adminClient.post(`/users/${id}/wallet`, data).then((res) => res.data);

// 3. Story & Episode Management
export const getAdminStories = (params?: { status?: string; category_id?: number; language?: string; search?: string; page?: number }) =>
  adminClient.get('/stories', { params }).then((res) => res.data);

export const updateAdminStoryStatus = (id: string | number, status: string) =>
  adminClient.put(`/stories/${id}/status`, { status }).then((res) => res.data);

export const deleteAdminStory = (id: string | number) =>
  adminClient.delete(`/stories/${id}`).then((res) => res.data);

export const getAdminEpisodes = (params?: { story_id?: number; search?: string; is_premium?: string; page?: number }) =>
  adminClient.get('/episodes', { params }).then((res) => res.data);

export const deleteAdminEpisode = (id: string | number) =>
  adminClient.delete(`/episodes/${id}`).then((res) => res.data);

// 4. Categories Management
export const getAdminCategories = () => adminClient.get('/categories').then((res) => res.data);
export const createAdminCategory = (formData: FormData) =>
  adminClient.post('/categories', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((res) => res.data);
export const updateAdminCategory = (id: string | number, formData: FormData) =>
  adminClient.put(`/categories/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((res) => res.data);
export const deleteAdminCategory = (id: string | number) =>
  adminClient.delete(`/categories/${id}`).then((res) => res.data);

// 5. Promotional Banners
export const getAdminBanners = () => adminClient.get('/banners').then((res) => res.data);
export const createAdminBanner = (formData: FormData) =>
  adminClient.post('/banners', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((res) => res.data);
export const updateAdminBanner = (id: string | number, formData: FormData) =>
  adminClient.put(`/banners/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((res) => res.data);
export const deleteAdminBanner = (id: string | number) =>
  adminClient.delete(`/banners/${id}`).then((res) => res.data);

// 6. Subscription Plans & Coin Packs
export const getAdminPlans = () => adminClient.get('/plans').then((res) => res.data);
export const createAdminPlan = (data: any) => adminClient.post('/plans', data).then((res) => res.data);
export const updateAdminPlan = (id: string | number, data: any) => adminClient.put(`/plans/${id}`, data).then((res) => res.data);
export const deleteAdminPlan = (id: string | number) => adminClient.delete(`/plans/${id}`).then((res) => res.data);

export const getAdminCoinPacks = () => adminClient.get('/coin-packs').then((res) => res.data);
export const createAdminCoinPack = (data: any) => adminClient.post('/coin-packs', data).then((res) => res.data);
export const updateAdminCoinPack = (id: string | number, data: any) => adminClient.put(`/coin-packs/${id}`, data).then((res) => res.data);
export const deleteAdminCoinPack = (id: string | number) => adminClient.delete(`/coin-packs/${id}`).then((res) => res.data);

export const getAdminTransactions = (params?: { type?: string; search?: string; page?: number }) =>
  adminClient.get('/transactions', { params }).then((res) => res.data);

// 7. Content Moderation
export const getAdminReviews = (params?: { story_id?: number; page?: number }) =>
  adminClient.get('/reviews', { params }).then((res) => res.data);
export const deleteAdminReview = (id: string | number) => adminClient.delete(`/reviews/${id}`).then((res) => res.data);

export const getAdminComments = (params?: { story_id?: number; page?: number }) =>
  adminClient.get('/comments', { params }).then((res) => res.data);
export const deleteAdminComment = (id: string | number) => adminClient.delete(`/comments/${id}`).then((res) => res.data);

// 8. System Settings & Notifications
export const getAdminSettings = () => adminClient.get('/settings').then((res) => res.data);
export const updateAdminSettings = (data: Record<string, any>) => adminClient.post('/settings', data).then((res) => res.data);
export const sendAdminNotification = (data: { title: string; body: string; user_id?: number; action_type?: string; action_value?: string }) =>
  adminClient.post('/notifications/send', data).then((res) => res.data);

export const createAdminFaq = (data: any) => adminClient.post('/faqs', data).then((res) => res.data);
export const updateAdminFaq = (id: string | number, data: any) => adminClient.put(`/faqs/${id}`, data).then((res) => res.data);
export const deleteAdminFaq = (id: string | number) => adminClient.delete(`/faqs/${id}`).then((res) => res.data);
