DELIMITER //

CREATE PROCEDURE DropPaymentMethodIfExists()
BEGIN
    IF EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'sales_invoices'
        AND COLUMN_NAME = 'payment_method'
    ) THEN
        ALTER TABLE sales_invoices DROP COLUMN payment_method;
    END IF;
END//

DELIMITER ;

CALL DropPaymentMethodIfExists();
DROP PROCEDURE DropPaymentMethodIfExists;
