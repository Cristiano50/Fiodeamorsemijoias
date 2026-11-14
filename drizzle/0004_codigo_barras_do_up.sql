ALTER TABLE `produtos` ADD `codigo_barras_origem` text;--> statement-breakpoint
-- Os códigos que já existiam foram gerados pelo app (EAN interno 91…).
UPDATE `produtos` SET `codigo_barras_origem` = 'app' WHERE `codigo_barras` IS NOT NULL;
