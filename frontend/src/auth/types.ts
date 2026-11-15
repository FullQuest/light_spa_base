export interface UserPublic {
  id: number;
  email: string;
  full_name: string | null;
  role: string;
  role_name: string;
  permissions: string[];
  is_active: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface Role {
  id: string;
  name: string;
  permissions: string[];
}
