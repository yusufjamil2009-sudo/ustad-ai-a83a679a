export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      api_configs: {
        Row: {
          config: Json;
          created_at: string;
          guest_id: string;
          healthy: boolean | null;
          id: string;
          last_tested_at: string | null;
          latency_ms: number | null;
          models: Json;
          provider: string;
          status: string;
          status_detail: string | null;
          updated_at: string;
        };
        Insert: {
          config?: Json;
          created_at?: string;
          guest_id: string;
          healthy?: boolean | null;
          id?: string;
          last_tested_at?: string | null;
          latency_ms?: number | null;
          models?: Json;
          provider: string;
          status?: string;
          status_detail?: string | null;
          updated_at?: string;
        };
        Update: {
          config?: Json;
          created_at?: string;
          guest_id?: string;
          healthy?: boolean | null;
          id?: string;
          last_tested_at?: string | null;
          latency_ms?: number | null;
          models?: Json;
          provider?: string;
          status?: string;
          status_detail?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "api_configs_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      attachments: {
        Row: {
          conversation_id: string | null;
          created_at: string;
          data: string;
          extracted_text: string | null;
          guest_id: string;
          id: string;
          kind: string;
          mime: string;
          name: string;
          size: number;
        };
        Insert: {
          conversation_id?: string | null;
          created_at?: string;
          data?: string;
          extracted_text?: string | null;
          guest_id: string;
          id?: string;
          kind: string;
          mime: string;
          name: string;
          size?: number;
        };
        Update: {
          conversation_id?: string | null;
          created_at?: string;
          data?: string;
          extracted_text?: string | null;
          guest_id?: string;
          id?: string;
          kind?: string;
          mime?: string;
          name?: string;
          size?: number;
        };
        Relationships: [
          {
            foreignKeyName: "attachments_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attachments_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      gallery_images: {
        Row: {
          created_at: string;
          file_size: number;
          guest_id: string;
          height: number;
          id: string;
          mime: string;
          optimized: boolean;
          original_name: string;
          storage_path: string;
          width: number;
        };
        Insert: {
          created_at?: string;
          file_size?: number;
          guest_id: string;
          height?: number;
          id?: string;
          mime: string;
          optimized?: boolean;
          original_name?: string;
          storage_path: string;
          width?: number;
        };
        Update: {
          created_at?: string;
          file_size?: number;
          guest_id?: string;
          height?: number;
          id?: string;
          mime?: string;
          optimized?: boolean;
          original_name?: string;
          storage_path?: string;
          width?: number;
        };
        Relationships: [
          {
            foreignKeyName: "gallery_images_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      gallery_share_items: {
        Row: {
          created_at: string;
          image_id: string;
          share_id: string;
        };
        Insert: {
          created_at?: string;
          image_id: string;
          share_id: string;
        };
        Update: {
          created_at?: string;
          image_id?: string;
          share_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gallery_share_items_image_id_fkey";
            columns: ["image_id"];
            isOneToOne: false;
            referencedRelation: "gallery_images";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gallery_share_items_share_id_fkey";
            columns: ["share_id"];
            isOneToOne: false;
            referencedRelation: "gallery_shares";
            referencedColumns: ["id"];
          },
        ];
      };
      gallery_shares: {
        Row: {
          created_at: string;
          guest_id: string;
          id: string;
          share_token: string;
          signature: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          guest_id: string;
          id?: string;
          share_token: string;
          signature?: string;
          title?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          guest_id?: string;
          id?: string;
          share_token?: string;
          signature?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gallery_shares_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          created_at: string;
          guest_id: string;
          id: string;
          pinned: boolean;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          guest_id: string;
          id?: string;
          pinned?: boolean;
          title?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          guest_id?: string;
          id?: string;
          pinned?: boolean;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      curriculum_boards: {
        Row: {
          aliases: Json;
          board_id: string;
          created_at: string;
          name: string;
          session_start_month: number;
        };
        Insert: {
          aliases?: Json;
          board_id: string;
          created_at?: string;
          name: string;
          session_start_month: number;
        };
        Update: {
          aliases?: Json;
          board_id?: string;
          created_at?: string;
          name?: string;
          session_start_month?: number;
        };
        Relationships: [];
      };
      curriculum_books: {
        Row: {
          academic_session: string;
          board_id: string;
          book_id: string;
          book_name: string;
          book_part: string | null;
          created_at: string;
          edition: string | null;
          klass: number;
          last_verified_at: string | null;
          record_status: string;
          source_reference: string | null;
          subject_id: string;
          verification_status: string;
        };
        Insert: {
          academic_session: string;
          board_id: string;
          book_id: string;
          book_name: string;
          book_part?: string | null;
          created_at?: string;
          edition?: string | null;
          klass: number;
          last_verified_at?: string | null;
          record_status?: string;
          source_reference?: string | null;
          subject_id: string;
          verification_status?: string;
        };
        Update: {
          academic_session?: string;
          board_id?: string;
          book_id?: string;
          book_name?: string;
          book_part?: string | null;
          created_at?: string;
          edition?: string | null;
          klass?: number;
          last_verified_at?: string | null;
          record_status?: string;
          source_reference?: string | null;
          subject_id?: string;
          verification_status?: string;
        };
        Relationships: [];
      };
      curriculum_chapters: {
        Row: {
          book_id: string;
          chapter_id: string;
          chapter_name: string;
          chapter_number: number;
          chapter_order: number;
          created_at: string;
          last_verified_at: string | null;
          source_reference: string | null;
          verification_status: string;
        };
        Insert: {
          book_id: string;
          chapter_id: string;
          chapter_name: string;
          chapter_number: number;
          chapter_order: number;
          created_at?: string;
          last_verified_at?: string | null;
          source_reference?: string | null;
          verification_status?: string;
        };
        Update: {
          book_id?: string;
          chapter_id?: string;
          chapter_name?: string;
          chapter_number?: number;
          chapter_order?: number;
          created_at?: string;
          last_verified_at?: string | null;
          source_reference?: string | null;
          verification_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "curriculum_chapters_book_id_fkey";
            columns: ["book_id"];
            isOneToOne: false;
            referencedRelation: "curriculum_books";
            referencedColumns: ["book_id"];
          },
        ];
      };
      curriculum_chapters_detail: {
        Row: {
          book_id: string;
          chapter_id: string;
          chapter_name: string;
          chapter_number: number;
          concepts_count: number;
          created_at: string;
          examples_count: number;
          extracted_at: string;
          formulas_count: number;
          questions_count: number;
          record_status: string;
          section_order: number[];
          source_reference: string | null;
          summary: string | null;
          topics_count: number;
          verification_status: string;
          version: string;
        };
        Insert: {
          book_id: string;
          chapter_id: string;
          chapter_name: string;
          chapter_number: number;
          concepts_count?: number;
          created_at?: string;
          examples_count?: number;
          extracted_at?: string;
          formulas_count?: number;
          questions_count?: number;
          record_status?: string;
          section_order?: number[];
          source_reference?: string | null;
          summary?: string | null;
          topics_count?: number;
          verification_status?: string;
          version?: string;
        };
        Update: {
          book_id?: string;
          chapter_id?: string;
          chapter_name?: string;
          chapter_number?: number;
          concepts_count?: number;
          created_at?: string;
          examples_count?: number;
          extracted_at?: string;
          formulas_count?: number;
          questions_count?: number;
          record_status?: string;
          section_order?: number[];
          source_reference?: string | null;
          summary?: string | null;
          topics_count?: number;
          verification_status?: string;
          version?: string;
        };
        Relationships: [];
      };
      curriculum_concepts: {
        Row: {
          book_id: string;
          chapter_id: string;
          concept_id: string;
          created_at: string;
          kind: string;
          math_raw: string | null;
          source_location: string | null;
          text: string;
          topic_id: string | null;
          variables: string[] | null;
        };
        Insert: {
          book_id: string;
          chapter_id: string;
          concept_id: string;
          created_at?: string;
          kind?: string;
          math_raw?: string | null;
          source_location?: string | null;
          text: string;
          topic_id?: string | null;
          variables?: string[] | null;
        };
        Update: {
          book_id?: string;
          chapter_id?: string;
          concept_id?: string;
          created_at?: string;
          kind?: string;
          math_raw?: string | null;
          source_location?: string | null;
          text?: string;
          topic_id?: string | null;
          variables?: string[] | null;
        };
        Relationships: [];
      };
      curriculum_questions: {
        Row: {
          answer_reference: string | null;
          book_id: string;
          chapter_id: string;
          created_at: string;
          diagram_required: boolean;
          question_id: string;
          question_type: string;
          related_concept: string | null;
          related_formula: string | null;
          section_id: string | null;
          source_location: string | null;
          text: string;
        };
        Insert: {
          answer_reference?: string | null;
          book_id: string;
          chapter_id: string;
          created_at?: string;
          diagram_required?: boolean;
          question_id: string;
          question_type?: string;
          related_concept?: string | null;
          related_formula?: string | null;
          section_id?: string | null;
          source_location?: string | null;
          text: string;
        };
        Update: {
          answer_reference?: string | null;
          book_id?: string;
          chapter_id?: string;
          created_at?: string;
          diagram_required?: boolean;
          question_id?: string;
          question_type?: string;
          related_concept?: string | null;
          related_formula?: string | null;
          section_id?: string | null;
          source_location?: string | null;
          text?: string;
        };
        Relationships: [];
      };
      curriculum_sections: {
        Row: {
          book_id: string;
          chapter_id: string;
          created_at: string;
          order: number;
          section_id: string;
          title: string;
        };
        Insert: {
          book_id: string;
          chapter_id: string;
          created_at?: string;
          order?: number;
          section_id: string;
          title: string;
        };
        Update: {
          book_id?: string;
          chapter_id?: string;
          created_at?: string;
          order?: number;
          section_id?: string;
          title?: string;
        };
        Relationships: [];
      };
      curriculum_sessions: {
        Row: {
          board_id: string;
          created_at: string;
          end_year: number;
          label: string;
          session_id: string;
          start_year: number;
        };
        Insert: {
          board_id: string;
          created_at?: string;
          end_year: number;
          label: string;
          session_id: string;
          start_year: number;
        };
        Update: {
          board_id?: string;
          created_at?: string;
          end_year?: number;
          label?: string;
          session_id?: string;
          start_year?: number;
        };
        Relationships: [
          {
            foreignKeyName: "curriculum_sessions_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "curriculum_boards";
            referencedColumns: ["board_id"];
          },
        ];
      };
      curriculum_subjects: {
        Row: {
          board_id: string;
          created_at: string;
          klass: number;
          name: string;
          subject_id: string;
        };
        Insert: {
          board_id: string;
          created_at?: string;
          klass: number;
          name: string;
          subject_id: string;
        };
        Update: {
          board_id?: string;
          created_at?: string;
          klass?: number;
          name?: string;
          subject_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "curriculum_subjects_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "curriculum_boards";
            referencedColumns: ["board_id"];
          },
        ];
      };
      curriculum_topics: {
        Row: {
          book_id: string;
          chapter_id: string;
          content: string | null;
          created_at: string;
          order: number;
          section_id: string | null;
          title: string;
          topic_id: string;
        };
        Insert: {
          book_id: string;
          chapter_id: string;
          content?: string | null;
          created_at?: string;
          order?: number;
          section_id?: string | null;
          title: string;
          topic_id: string;
        };
        Update: {
          book_id?: string;
          chapter_id?: string;
          content?: string | null;
          created_at?: string;
          order?: number;
          section_id?: string | null;
          title?: string;
          topic_id?: string;
        };
        Relationships: [];
      };
      curriculum_verifications: {
        Row: {
          academic_session: string;
          board_id: string;
          book_id: string;
          id: number;
          klass: number;
          record_status: string;
          source_reference: string | null;
          subject_id: string;
          verification_status: string;
          verified_at: string;
        };
        Insert: {
          academic_session: string;
          board_id: string;
          book_id: string;
          id?: never;
          klass: number;
          record_status: string;
          source_reference?: string | null;
          subject_id: string;
          verification_status: string;
          verified_at?: string;
        };
        Update: {
          academic_session?: string;
          board_id?: string;
          book_id?: string;
          id?: never;
          klass?: number;
          record_status?: string;
          source_reference?: string | null;
          subject_id?: string;
          verification_status?: string;
          verified_at?: string;
        };
        Relationships: [];
      };
      exam_batches: {
        Row: {
          board: string | null;
          created_at: string;
          difficulty: string;
          district: string | null;
          duration_minutes: number;
          father_name: string | null;
          guest_id: string;
          id: string;
          klass: string;
          language: string;
          mother_name: string | null;
          negative_marking: number;
          question_type: string;
          status: string;
          student_name: string;
          subjects: Json;
          timezone: string;
          title: string;
          updated_at: string;
          village: string | null;
        };
        Insert: {
          board?: string | null;
          created_at?: string;
          difficulty?: string;
          district?: string | null;
          duration_minutes?: number;
          father_name?: string | null;
          guest_id: string;
          id?: string;
          klass?: string;
          language?: string;
          mother_name?: string | null;
          negative_marking?: number;
          question_type?: string;
          status?: string;
          student_name?: string;
          subjects?: Json;
          timezone?: string;
          title: string;
          updated_at?: string;
          village?: string | null;
        };
        Update: {
          board?: string | null;
          created_at?: string;
          difficulty?: string;
          district?: string | null;
          duration_minutes?: number;
          father_name?: string | null;
          guest_id?: string;
          id?: string;
          klass?: string;
          language?: string;
          mother_name?: string | null;
          negative_marking?: number;
          question_type?: string;
          status?: string;
          student_name?: string;
          subjects?: Json;
          timezone?: string;
          title?: string;
          updated_at?: string;
          village?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "exam_batches_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      exam_combined_results: {
        Row: {
          batch_id: string | null;
          created_at: string;
          division: string;
          exam_ids: Json;
          guest_id: string;
          id: string;
          partial: boolean;
          percentage: number;
          student: Json;
          subjects: Json;
          title: string;
          total_max: number;
          total_obtained: number;
          updated_at: string;
        };
        Insert: {
          batch_id?: string | null;
          created_at?: string;
          division?: string;
          exam_ids?: Json;
          guest_id: string;
          id?: string;
          partial?: boolean;
          percentage?: number;
          student?: Json;
          subjects?: Json;
          title?: string;
          total_max?: number;
          total_obtained?: number;
          updated_at?: string;
        };
        Update: {
          batch_id?: string | null;
          created_at?: string;
          division?: string;
          exam_ids?: Json;
          guest_id?: string;
          id?: string;
          partial?: boolean;
          percentage?: number;
          student?: Json;
          subjects?: Json;
          title?: string;
          total_max?: number;
          total_obtained?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exam_combined_results_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "exam_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exam_combined_results_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      exam_results: {
        Row: {
          answers: Json;
          batch_id: string | null;
          correct_count: number;
          created_at: string;
          details: Json;
          division: string;
          evaluation_status: string;
          exam_id: string;
          guest_id: string;
          id: string;
          max_marks: number;
          negative_total: number;
          obtained: number;
          percentage: number;
          score: number;
          started_at: string | null;
          subject: string | null;
          submitted_at: string;
          time_taken_seconds: number | null;
          total: number;
          unanswered_count: number;
          wrong_count: number;
        };
        Insert: {
          answers?: Json;
          batch_id?: string | null;
          correct_count?: number;
          created_at?: string;
          details?: Json;
          division?: string;
          evaluation_status?: string;
          exam_id: string;
          guest_id: string;
          id?: string;
          max_marks?: number;
          negative_total?: number;
          obtained?: number;
          percentage?: number;
          score?: number;
          started_at?: string | null;
          subject?: string | null;
          submitted_at?: string;
          time_taken_seconds?: number | null;
          total?: number;
          unanswered_count?: number;
          wrong_count?: number;
        };
        Update: {
          answers?: Json;
          batch_id?: string | null;
          correct_count?: number;
          created_at?: string;
          details?: Json;
          division?: string;
          evaluation_status?: string;
          exam_id?: string;
          guest_id?: string;
          id?: string;
          max_marks?: number;
          negative_total?: number;
          obtained?: number;
          percentage?: number;
          score?: number;
          started_at?: string | null;
          subject?: string | null;
          submitted_at?: string;
          time_taken_seconds?: number | null;
          total?: number;
          unanswered_count?: number;
          wrong_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "exam_results_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "exam_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exam_results_exam_id_fkey";
            columns: ["exam_id"];
            isOneToOne: false;
            referencedRelation: "exams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exam_results_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      exam_sessions: {
        Row: {
          answers: Json;
          created_at: string;
          current_index: number;
          exam_id: string;
          expires_at: string;
          guest_id: string;
          id: string;
          started_at: string;
          submitted: boolean;
          updated_at: string;
        };
        Insert: {
          answers?: Json;
          created_at?: string;
          current_index?: number;
          exam_id: string;
          expires_at: string;
          guest_id: string;
          id?: string;
          started_at?: string;
          submitted?: boolean;
          updated_at?: string;
        };
        Update: {
          answers?: Json;
          created_at?: string;
          current_index?: number;
          exam_id?: string;
          expires_at?: string;
          guest_id?: string;
          id?: string;
          started_at?: string;
          submitted?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exam_sessions_exam_id_fkey";
            columns: ["exam_id"];
            isOneToOne: false;
            referencedRelation: "exams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exam_sessions_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      exams: {
        Row: {
          batch_id: string | null;
          config: Json;
          created_at: string;
          delivered_at: string | null;
          difficulty: string;
          duration_minutes: number;
          ends_at: string | null;
          generation_error: string | null;
          guest_id: string;
          id: string;
          klass: string | null;
          language: string;
          max_marks: number;
          negative_marking: number;
          question_type: string;
          questions: Json;
          scheduled_at: string | null;
          sort_order: number;
          started_at: string | null;
          status: string;
          subject: string | null;
          timezone: string;
          topic: string;
          updated_at: string;
        };
        Insert: {
          batch_id?: string | null;
          config?: Json;
          created_at?: string;
          delivered_at?: string | null;
          difficulty?: string;
          duration_minutes?: number;
          ends_at?: string | null;
          generation_error?: string | null;
          guest_id: string;
          id?: string;
          klass?: string | null;
          language?: string;
          max_marks?: number;
          negative_marking?: number;
          question_type?: string;
          questions?: Json;
          scheduled_at?: string | null;
          sort_order?: number;
          started_at?: string | null;
          status?: string;
          subject?: string | null;
          timezone?: string;
          topic: string;
          updated_at?: string;
        };
        Update: {
          batch_id?: string | null;
          config?: Json;
          created_at?: string;
          delivered_at?: string | null;
          difficulty?: string;
          duration_minutes?: number;
          ends_at?: string | null;
          generation_error?: string | null;
          guest_id?: string;
          id?: string;
          klass?: string | null;
          language?: string;
          max_marks?: number;
          negative_marking?: number;
          question_type?: string;
          questions?: Json;
          scheduled_at?: string | null;
          sort_order?: number;
          started_at?: string | null;
          status?: string;
          subject?: string | null;
          timezone?: string;
          topic?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exams_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "exam_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exams_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      goals: {
        Row: {
          created_at: string;
          details: string | null;
          guest_id: string;
          id: string;
          progress: number;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          details?: string | null;
          guest_id: string;
          id?: string;
          progress?: number;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          details?: string | null;
          guest_id?: string;
          id?: string;
          progress?: number;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "goals_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      guests: {
        Row: {
          created_at: string;
          id: string;
          last_seen_at: string;
        };
        Insert: {
          created_at?: string;
          id: string;
          last_seen_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_seen_at?: string;
        };
        Relationships: [];
      };
      lessons: {
        Row: {
          content: Json;
          created_at: string;
          guest_id: string;
          id: string;
          language: string;
          level: string;
          topic: string;
        };
        Insert: {
          content?: Json;
          created_at?: string;
          guest_id: string;
          id?: string;
          language?: string;
          level?: string;
          topic: string;
        };
        Update: {
          content?: Json;
          created_at?: string;
          guest_id?: string;
          id?: string;
          language?: string;
          level?: string;
          topic?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lessons_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      memories: {
        Row: {
          content: string;
          created_at: string;
          guest_id: string;
          id: string;
          kind: string;
          source: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          guest_id: string;
          id?: string;
          kind?: string;
          source?: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          guest_id?: string;
          id?: string;
          kind?: string;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memories_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          attachments: Json;
          content: string;
          conversation_id: string;
          created_at: string;
          guest_id: string;
          id: string;
          meta: Json;
          role: string;
        };
        Insert: {
          attachments?: Json;
          content?: string;
          conversation_id: string;
          created_at?: string;
          guest_id: string;
          id?: string;
          meta?: Json;
          role: string;
        };
        Update: {
          attachments?: Json;
          content?: string;
          conversation_id?: string;
          created_at?: string;
          guest_id?: string;
          id?: string;
          meta?: Json;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      notes: {
        Row: {
          content: string;
          created_at: string;
          guest_id: string;
          id: string;
          source: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          content?: string;
          created_at?: string;
          guest_id: string;
          id?: string;
          source?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          guest_id?: string;
          id?: string;
          source?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notes_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          age: number | null;
          board: string | null;
          education: string | null;
          guest_id: string;
          interests: string | null;
          klass: string | null;
          language: string;
          learning_preferences: string | null;
          name: string | null;
          updated_at: string;
        };
        Insert: {
          age?: number | null;
          board?: string | null;
          education?: string | null;
          guest_id: string;
          interests?: string | null;
          klass?: string | null;
          language?: string;
          learning_preferences?: string | null;
          name?: string | null;
          updated_at?: string;
        };
        Update: {
          age?: number | null;
          board?: string | null;
          education?: string | null;
          guest_id?: string;
          interests?: string | null;
          klass?: string | null;
          language?: string;
          learning_preferences?: string | null;
          name?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: true;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      reminders: {
        Row: {
          created_at: string;
          done: boolean;
          due_at: string;
          guest_id: string;
          id: string;
          kind: string;
          note: string | null;
          notified_at: string | null;
          payload: Json;
          repeat_rule: string;
          title: string;
        };
        Insert: {
          created_at?: string;
          done?: boolean;
          due_at: string;
          guest_id: string;
          id?: string;
          kind?: string;
          note?: string | null;
          notified_at?: string | null;
          payload?: Json;
          repeat_rule?: string;
          title: string;
        };
        Update: {
          created_at?: string;
          done?: boolean;
          due_at?: string;
          guest_id?: string;
          id?: string;
          kind?: string;
          note?: string | null;
          notified_at?: string | null;
          payload?: Json;
          repeat_rule?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reminders_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      request_idempotency: {
        Row: {
          created_at: string;
          guest_id: string;
          id: string;
          kind: string;
          result: Json;
        };
        Insert: {
          created_at?: string;
          guest_id: string;
          id: string;
          kind: string;
          result: Json;
        };
        Update: {
          created_at?: string;
          guest_id?: string;
          id?: string;
          kind?: string;
          result?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "request_idempotency_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
      settings: {
        Row: {
          auto_speak: boolean;
          data_saver: boolean;
          extras: Json;
          guest_id: string;
          language: string;
          theme: string;
          timezone: string | null;
          updated_at: string;
          voice: Json;
          web_search: boolean;
        };
        Insert: {
          auto_speak?: boolean;
          data_saver?: boolean;
          extras?: Json;
          guest_id: string;
          language?: string;
          theme?: string;
          timezone?: string | null;
          updated_at?: string;
          voice?: Json;
          web_search?: boolean;
        };
        Update: {
          auto_speak?: boolean;
          data_saver?: boolean;
          extras?: Json;
          guest_id?: string;
          language?: string;
          theme?: string;
          timezone?: string | null;
          updated_at?: string;
          voice?: Json;
          web_search?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "settings_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: true;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
