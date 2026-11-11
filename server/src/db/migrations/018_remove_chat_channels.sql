-- DOD Minimal: Report sends by email only. The WhatsApp/Telegram channels (never implemented) and the
-- application contact (Settings → Kontak Aplikasi) were removed from the application.
-- Only this application's own tables are touched. A column is dropped only when it holds no data;
-- otherwise it is kept (with a NOTICE) and simply no longer used. The code reads and writes none of them.

-- application contact (WhatsApp/Telegram buttons on Beranda)
DELETE FROM dor_setting WHERE key = 'app.contact';
DELETE FROM dor_role_menu WHERE menu_id = 'settings.contact';

DO $$
BEGIN
  -- recipients: phone (WhatsApp) and Telegram contacts, preferred channel
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'dor_recipient' AND column_name = 'phone') THEN
    IF NOT EXISTS (SELECT 1 FROM dor_recipient WHERE phone IS NOT NULL AND phone <> '') THEN
      ALTER TABLE dor_recipient DROP COLUMN phone;
    ELSE
      RAISE NOTICE 'dor_recipient.phone berisi data; kolom dibiarkan (tidak dipakai lagi).';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'dor_recipient' AND column_name = 'telegram') THEN
    IF NOT EXISTS (SELECT 1 FROM dor_recipient WHERE telegram IS NOT NULL AND telegram <> '') THEN
      ALTER TABLE dor_recipient DROP COLUMN telegram;
    ELSE
      RAISE NOTICE 'dor_recipient.telegram berisi data; kolom dibiarkan (tidak dipakai lagi).';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'dor_recipient' AND column_name = 'preferred') THEN
    ALTER TABLE dor_recipient DROP COLUMN preferred;  -- only email remains, nothing to prefer
  END IF;

  -- distributions: chat message and channel rule
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'dor_distribution' AND column_name = 'chat_message') THEN
    IF NOT EXISTS (SELECT 1 FROM dor_distribution WHERE chat_message <> '') THEN
      ALTER TABLE dor_distribution DROP COLUMN chat_message;
    ELSE
      RAISE NOTICE 'dor_distribution.chat_message berisi data; kolom dibiarkan (tidak dipakai lagi).';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'dor_distribution' AND column_name = 'channel_mode') THEN
    IF NOT EXISTS (SELECT 1 FROM dor_distribution) THEN
      ALTER TABLE dor_distribution DROP COLUMN channel_mode;
    ELSE
      ALTER TABLE dor_distribution ALTER COLUMN channel_mode SET DEFAULT 'all';
      RAISE NOTICE 'dor_distribution.channel_mode berisi riwayat; kolom dibiarkan (tidak dipakai lagi).';
    END IF;
  END IF;
END $$;
