export type Json =
	| string
	| number
	| boolean
	| null
	| { [key: string]: Json | undefined }
	| Json[];

export interface Database {
	public: {
		Tables: {
      birthday_letters: {
        Row: { id: string; space_id: string; occasion_key: string; sender_id: string; recipient_id: string; recipient_name: string; opens_at: string; body: string; signature: string; is_ready: boolean; opened_at: string | null; updated_at: string };
        Insert: { id?: string; space_id: string; occasion_key: string; sender_id: string; recipient_id: string; recipient_name: string; opens_at: string; body?: string; signature?: string; is_ready?: boolean; opened_at?: string | null; updated_at?: string };
        Update: { body?: string; signature?: string; is_ready?: boolean };
        Relationships: [];
      };
			profiles: {
				Row: {
					id: string;
					display_name: string;
					avatar_url: string | null;
					theme_color: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id: string;
					display_name: string;
					avatar_url?: string | null;
					theme_color?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					display_name?: string;
					avatar_url?: string | null;
					theme_color?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "profiles_id_fkey";
						columns: ["id"];
						isOneToOne: true;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
				];
			};
			spaces: {
				Row: {
					id: string;
					name: string;
					created_by: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id?: string;
					name: string;
					created_by?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					name?: string;
					created_by?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "spaces_created_by_fkey";
						columns: ["created_by"];
						isOneToOne: false;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
				];
			};
			space_members: {
				Row: {
					space_id: string;
					user_id: string;
					joined_at: string;
				};
				Insert: {
					space_id: string;
					user_id: string;
					joined_at?: string;
				};
				Update: {
					space_id?: string;
					user_id?: string;
					joined_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "space_members_space_id_fkey";
						columns: ["space_id"];
						isOneToOne: false;
						referencedRelation: "spaces";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "space_members_user_id_fkey";
						columns: ["user_id"];
						isOneToOne: false;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
				];
			};
			memories: {
				Row: {
					id: string;
					space_id: string;
					memory_date: string;
					title: string | null;
					location: string | null;
					latitude: number | null;
					longitude: number | null;
					weather: string | null;
					temperature: string | null;
					song_title: string | null;
					song_artist: string | null;
					note: string | null;
					created_by: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id?: string;
					space_id: string;
					memory_date: string;
					title?: string | null;
					location?: string | null;
					latitude?: number | null;
					longitude?: number | null;
					weather?: string | null;
					temperature?: string | null;
					song_title?: string | null;
					song_artist?: string | null;
					note?: string | null;
					created_by?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					space_id?: string;
					memory_date?: string;
					title?: string | null;
					location?: string | null;
					latitude?: number | null;
					longitude?: number | null;
					weather?: string | null;
					temperature?: string | null;
					song_title?: string | null;
					song_artist?: string | null;
					note?: string | null;
					created_by?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "memories_space_id_fkey";
						columns: ["space_id"];
						isOneToOne: false;
						referencedRelation: "spaces";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "memories_created_by_fkey";
						columns: ["created_by"];
						isOneToOne: false;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
				];
			};
			perspectives: {
				Row: {
					id: string;
					memory_id: string;
					user_id: string;
					content: string;
					mood: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id?: string;
					memory_id: string;
					user_id: string;
					content?: string;
					mood?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					memory_id?: string;
					user_id?: string;
					content?: string;
					mood?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "perspectives_memory_id_fkey";
						columns: ["memory_id"];
						isOneToOne: false;
						referencedRelation: "memories";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "perspectives_user_id_fkey";
						columns: ["user_id"];
						isOneToOne: false;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
				];
			};
			memory_photos: {
				Row: {
					id: string;
					memory_id: string;
					uploaded_by: string | null;
					storage_path: string;
					width: number | null;
					height: number | null;
					sort_order: number;
					created_at: string;
				};
				Insert: {
					id?: string;
					memory_id: string;
					uploaded_by?: string | null;
					storage_path: string;
					width?: number | null;
					height?: number | null;
					sort_order?: number;
					created_at?: string;
				};
				Update: {
					id?: string;
					memory_id?: string;
					uploaded_by?: string | null;
					storage_path?: string;
					width?: number | null;
					height?: number | null;
					sort_order?: number;
					created_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "memory_photos_memory_id_fkey";
						columns: ["memory_id"];
						isOneToOne: false;
						referencedRelation: "memories";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "memory_photos_uploaded_by_fkey";
						columns: ["uploaded_by"];
						isOneToOne: false;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
				];
			};
		};
		Views: Record<string, never>;
		Functions: {
      open_birthday_letter: { Args: { letter_id: string }; Returns: string };
      create_memory_with_perspective: {
        Args: {p_id: string; p_space_id: string; p_date: string; p_title: string | null; p_location: string | null; p_content: string};
        Returns: Json;
      };
			is_space_member: {
				Args: { target_space_id: string };
				Returns: boolean;
			};
			is_space_creator: {
				Args: { target_space_id: string };
				Returns: boolean;
			};
			is_memory_member: {
				Args: { target_memory_id: string };
				Returns: boolean;
			};
			shares_space_with: {
				Args: { target_user_id: string };
				Returns: boolean;
			};
			memory_belongs_to_space: {
				Args: { target_memory_id: string; target_space_id: string };
				Returns: boolean;
			};
			path_segment_uuid: {
				Args: { object_name: string; segment_index: number };
				Returns: string | null;
			};
		};
		Enums: Record<string, never>;
		CompositeTypes: Record<string, never>;
	};
}
