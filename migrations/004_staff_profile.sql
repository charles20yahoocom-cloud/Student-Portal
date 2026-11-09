-- Staff profile settings: allow faculty/dean/admin accounts to store a profile photo
ALTER TABLE users ADD COLUMN profile_picture TEXT;
ALTER TABLE users ADD COLUMN picture_updated_at TEXT;
