-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Nov 03, 2026 at 03:05 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `warehouse_inventory`
--

-- --------------------------------------------------------

--
-- Table structure for table `apitoken`
--

CREATE TABLE `apitoken` (
  `TokenID` int(10) UNSIGNED NOT NULL,
  `StaffID` int(10) UNSIGNED NOT NULL,
  `TokenHash` char(64) NOT NULL,
  `CreatedAt` datetime NOT NULL DEFAULT current_timestamp(),
  `ExpiresAt` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `apitoken`
--

INSERT INTO `apitoken` (`TokenID`, `StaffID`, `TokenHash`, `CreatedAt`, `ExpiresAt`) VALUES
(8, 1, 'f3fdb39f4fefb2a754f622c13165ee1c69ce04e6d5b3bfb0cbe757b94681cfdf', '2026-11-02 15:22:33', '2026-11-02 23:22:33');

-- --------------------------------------------------------

--
-- Table structure for table `auditlog`
--

CREATE TABLE `auditlog` (
  `AuditID` bigint(20) UNSIGNED NOT NULL,
  `CreatedAt` datetime NOT NULL DEFAULT current_timestamp(),
  `StaffID` int(10) UNSIGNED DEFAULT NULL,
  `HandledBy` varchar(50) NOT NULL,
  `Module` varchar(40) NOT NULL,
  `Action` varchar(60) NOT NULL,
  `Description` varchar(500) NOT NULL,
  `IpAddress` varchar(45) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `auditlog`
--

INSERT INTO `auditlog` (`AuditID`, `CreatedAt`, `StaffID`, `HandledBy`, `Module`, `Action`, `Description`, `IpAddress`) VALUES
(1, '2026-10-30 20:54:52', 1, 'alex', 'Authentication', 'Signed in', 'User signed in.', '::1'),
(2, '2026-10-30 20:57:18', 1, 'alex', 'Users', 'Created', 'User zhoir (Admin) was created.', '::1'),
(3, '2026-10-30 20:59:51', 1, 'alex', 'Sales', 'Sale completed', 'Order Needs many gloves completed with 1 line item.', '::1'),
(4, '2026-10-30 21:01:28', 1, 'alex', 'Sales', 'Sale completed', 'Order Packing ape for totally legitimate reasons completed with 1 line item.', '::1'),
(5, '2026-10-30 21:04:25', 1, 'alex', 'Inventory', 'Category created', 'Pharmaceutical category created.', '::1'),
(6, '2026-10-30 21:05:12', 1, 'alex', 'Inventory', 'Product created', 'New SKU P00005 (Methylamine) added to rack slot 5.', '::1'),
(7, '2026-10-30 21:05:12', 1, 'alex', 'Inventory', 'Stock in', '1000 units of P00005 received; For the big cook out.', '::1'),
(8, '2026-10-30 21:06:21', 1, 'alex', 'Authentication', 'Signed out', 'User signed out.', '::1'),
(9, '2026-10-30 21:09:04', 1, 'alex', 'Authentication', 'Signed in', 'User signed in.', '::1'),
(10, '2026-10-30 21:12:26', 1, 'alex', 'Users', 'Updated', 'User jordan (Cashier) was updated.', '::1'),
(11, '2026-10-30 21:12:31', 1, 'alex', 'Users', 'Updated', 'User sam (Cashier) was updated.', '::1'),
(12, '2026-10-30 21:13:03', 1, 'alex', 'Users', 'Updated', 'User alex (Admin) was updated.', '::1'),
(13, '2026-10-30 21:14:28', 1, 'alex', 'Users', 'Updated', 'User zhoir (Admin) was updated (password reset).', '::1'),
(14, '2026-11-02 15:19:50', 1, 'alex', 'Authentication', 'Login failed', 'Wrong password or inactive account.', '::1'),
(15, '2026-11-02 15:19:54', 1, 'alex', 'Authentication', 'Login failed', 'Wrong password or inactive account.', '::1'),
(16, '2026-11-02 15:19:58', 1, 'alex', 'Authentication', 'Login failed', 'Wrong password or inactive account.', '::1'),
(17, '2026-11-02 15:19:59', 1, 'alex', 'Authentication', 'Login failed', 'Wrong password or inactive account.', '::1'),
(18, '2026-11-02 15:22:33', 1, 'alex', 'Authentication', 'Signed in', 'User signed in.', '::1'),
(19, '2026-11-02 15:24:13', 1, 'alex', 'Users', 'Updated', 'User zhoir (Admin) was updated (password reset).', '::1'),
(20, '2026-11-02 15:26:07', 1, 'alex', 'Sales', 'Sale completed', 'Order SO-261102-00007 completed with 1 line item.', '::1');

-- --------------------------------------------------------

--
-- Table structure for table `categories`
--

CREATE TABLE `categories` (
  `CategoryID` int(10) UNSIGNED NOT NULL,
  `CategoryName` varchar(60) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `categories`
--

INSERT INTO `categories` (`CategoryID`, `CategoryName`) VALUES
(9, 'Computer Parts'),
(4, 'Constructions'),
(6, 'Electrical'),
(7, 'Fixtures'),
(8, 'Others'),
(11, 'Pharmaceutical'),
(5, 'Plumbing'),
(1, 'Safety'),
(2, 'Supplies'),
(3, 'Tools');

-- --------------------------------------------------------

--
-- Table structure for table `inventory`
--

CREATE TABLE `inventory` (
  `InventoryID` int(10) UNSIGNED NOT NULL,
  `ProductID` int(10) UNSIGNED NOT NULL,
  `StockQuantity` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `Unit` varchar(20) NOT NULL DEFAULT 'pcs'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `inventory`
--

INSERT INTO `inventory` (`InventoryID`, `ProductID`, `StockQuantity`, `Unit`) VALUES
(1, 1, 119, 'pcs'),
(2, 2, 180, 'pair'),
(3, 3, 450, 'roll'),
(4, 4, 40, 'roll'),
(7, 7, 1000, 'pcs');

-- --------------------------------------------------------

--
-- Table structure for table `orderitem`
--

CREATE TABLE `orderitem` (
  `OrderItemID` int(10) UNSIGNED NOT NULL,
  `OrderID` int(10) UNSIGNED NOT NULL,
  `ProductID` int(10) UNSIGNED NOT NULL,
  `Quantity` int(10) UNSIGNED NOT NULL,
  `UnitPrice` decimal(10,2) NOT NULL,
  `LineTotal` decimal(12,2) NOT NULL,
  `ReturnedQuantity` int(10) UNSIGNED NOT NULL DEFAULT 0
) ;

--
-- Dumping data for table `orderitem`
--

INSERT INTO `orderitem` (`OrderItemID`, `OrderID`, `ProductID`, `Quantity`, `UnitPrice`, `LineTotal`, `ReturnedQuantity`) VALUES
(1, 1, 1, 3, 89.99, 269.97, 0),
(2, 2, 1, 2, 89.99, 179.98, 0),
(3, 3, 1, 3, 89.99, 269.97, 0),
(4, 4, 1, 2, 89.99, 179.98, 0),
(8, 5, 2, 20, 4.50, 90.00, 0),
(9, 6, 3, 50, 2.25, 112.50, 0),
(10, 7, 4, 20, 12.00, 240.00, 0);

-- --------------------------------------------------------

--
-- Table structure for table `orders`
--

CREATE TABLE `orders` (
  `OrderID` int(10) UNSIGNED NOT NULL,
  `StaffID` int(10) UNSIGNED NOT NULL,
  `OrderDate` datetime NOT NULL DEFAULT current_timestamp(),
  `CustomerName` varchar(80) DEFAULT NULL,
  `Reference` varchar(60) DEFAULT NULL,
  `Subtotal` decimal(12,2) NOT NULL,
  `DiscountRate` decimal(5,2) NOT NULL DEFAULT 0.00,
  `DiscountAmount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `VatRate` decimal(5,2) NOT NULL DEFAULT 0.00,
  `VatAmount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `Total` decimal(12,2) NOT NULL,
  `Status` enum('Pending','Completed','Cancelled') NOT NULL DEFAULT 'Pending'
) ;

--
-- Dumping data for table `orders`
--

INSERT INTO `orders` (`OrderID`, `StaffID`, `OrderDate`, `CustomerName`, `Reference`, `Subtotal`, `DiscountRate`, `DiscountAmount`, `VatRate`, `VatAmount`, `Total`, `Status`) VALUES
(1, 1, '2026-10-27 21:59:40', NULL, NULL, 269.97, 0.00, 0.00, 0.00, 0.00, 269.97, 'Completed'),
(2, 1, '2026-10-27 21:59:41', NULL, NULL, 179.98, 0.00, 0.00, 0.00, 0.00, 179.98, 'Cancelled'),
(3, 2, '2026-10-28 17:02:54', NULL, NULL, 269.97, 0.00, 0.00, 0.00, 0.00, 269.97, 'Completed'),
(4, 2, '2026-10-28 17:02:55', NULL, NULL, 179.98, 0.00, 0.00, 0.00, 0.00, 179.98, 'Cancelled'),
(5, 1, '2026-10-30 20:59:51', 'Adam', 'Needs many gloves', 90.00, 0.00, 0.00, 12.00, 10.80, 100.80, 'Completed'),
(6, 1, '2026-10-30 21:01:28', 'Snoopy', 'Packing ape for totally legitimate reasons', 112.50, 12.00, 13.50, 12.00, 11.88, 110.88, 'Completed'),
(7, 1, '2026-11-02 15:26:07', NULL, NULL, 240.00, 0.00, 0.00, 12.00, 28.80, 268.80, 'Completed');

-- --------------------------------------------------------

--
-- Table structure for table `products`
--

CREATE TABLE `products` (
  `ProductID` int(10) UNSIGNED NOT NULL,
  `SKU` varchar(40) NOT NULL,
  `ProductName` varchar(150) NOT NULL,
  `CategoryID` int(10) UNSIGNED DEFAULT NULL,
  `Size` varchar(50) DEFAULT NULL,
  `Price` decimal(10,2) NOT NULL DEFAULT 0.00,
  `RackSlot` tinyint(3) UNSIGNED DEFAULT NULL,
  `ReorderLevel` int(10) UNSIGNED NOT NULL DEFAULT 10
) ;

--
-- Dumping data for table `products`
--

INSERT INTO `products` (`ProductID`, `SKU`, `ProductName`, `CategoryID`, `Size`, `Price`, `RackSlot`, `ReorderLevel`) VALUES
(1, 'P00001', 'Cordless Drill', 3, '20V', 89.99, 0, 10),
(2, 'P00002', 'Safety Gloves', 1, 'Large', 4.50, 1, 10),
(3, 'P00003', 'Packing Tape', 2, '48mm x 100m', 2.25, 2, 10),
(4, 'P00004', 'Pallet Wrap', 2, '500mm', 12.00, 3, 10),
(7, 'P00005', 'Methylamine', 11, '900gal', 4000.00, 4, 10);

-- --------------------------------------------------------

--
-- Table structure for table `sales`
--

CREATE TABLE `sales` (
  `SalesID` int(10) UNSIGNED NOT NULL,
  `TransactionID` int(10) UNSIGNED NOT NULL,
  `SaleDate` date NOT NULL,
  `TotalSales` decimal(12,2) NOT NULL
) ;

--
-- Dumping data for table `sales`
--

INSERT INTO `sales` (`SalesID`, `TransactionID`, `SaleDate`, `TotalSales`) VALUES
(1, 1, '2026-10-27', 269.97),
(2, 2, '2026-10-28', 269.97),
(3, 3, '2026-10-30', 100.80),
(4, 4, '2026-10-30', 110.88),
(5, 5, '2026-11-02', 268.80);

-- --------------------------------------------------------

--
-- Table structure for table `salesreturn`
--

CREATE TABLE `salesreturn` (
  `ReturnID` int(10) UNSIGNED NOT NULL,
  `OrderItemID` int(10) UNSIGNED NOT NULL,
  `StaffID` int(10) UNSIGNED NOT NULL,
  `Quantity` int(10) UNSIGNED NOT NULL,
  `Reason` varchar(120) NOT NULL,
  `Status` enum('Subject for review','Reviewed') NOT NULL DEFAULT 'Subject for review',
  `CreatedAt` datetime NOT NULL DEFAULT current_timestamp(),
  `ReviewedBy` int(10) UNSIGNED DEFAULT NULL,
  `ReviewedAt` datetime DEFAULT NULL
) ;

-- --------------------------------------------------------

--
-- Table structure for table `staff`
--

CREATE TABLE `staff` (
  `StaffID` int(10) UNSIGNED NOT NULL,
  `StaffName` varchar(100) NOT NULL,
  `FirstName` varchar(60) NOT NULL DEFAULT '',
  `LastName` varchar(60) NOT NULL DEFAULT '',
  `Email` varchar(120) DEFAULT NULL,
  `Username` varchar(50) NOT NULL,
  `PasswordHash` varchar(255) NOT NULL,
  `Role` enum('Admin','Staff') NOT NULL DEFAULT 'Staff',
  `IsActive` tinyint(1) NOT NULL DEFAULT 1,
  `FailedLogins` tinyint(3) UNSIGNED NOT NULL DEFAULT 0,
  `LockedUntil` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `staff`
--

INSERT INTO `staff` (`StaffID`, `StaffName`, `FirstName`, `LastName`, `Email`, `Username`, `PasswordHash`, `Role`, `IsActive`, `FailedLogins`, `LockedUntil`) VALUES
(1, 'Alex Rivera', 'Alex', 'Rivera', 'samplemail@example.com', 'alex', '$2y$12$5uj62LcFVoaVV/8gm.TqcOnTvBlRty6XwFmJ2I/KxNCDUTozgC2U2', 'Admin', 1, 0, NULL),
(2, 'Sam Carter', 'Sam', 'Carter', 'samplemail@example.com', 'sam', '$2y$12$5uj62LcFVoaVV/8gm.TqcOnTvBlRty6XwFmJ2I/KxNCDUTozgC2U2', 'Staff', 1, 0, NULL),
(3, 'Jordan Lee', 'Jordan', 'Lee', 'samplemail@example.com', 'jordan', '$2y$12$5uj62LcFVoaVV/8gm.TqcOnTvBlRty6XwFmJ2I/KxNCDUTozgC2U2', 'Staff', 1, 0, NULL),
(6, 'Mr. Pepe Tanginamo', 'Mr. Pepe', 'Tanginamo', 'samplemail@example.com', 'zhoir', '$2y$12$pR6PEuL4jrsuW0GE1d9s9egmO5dJrLQ1Pdu2cPvjCVtabP4D8Xj/C', 'Admin', 1, 0, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `stockmovement`
--

CREATE TABLE `stockmovement` (
  `MovementID` bigint(20) UNSIGNED NOT NULL,
  `ProductID` int(10) UNSIGNED NOT NULL,
  `StaffID` int(10) UNSIGNED NOT NULL,
  `MovementType` enum('IN','OUT') NOT NULL,
  `Quantity` int(10) UNSIGNED NOT NULL,
  `Note` varchar(200) DEFAULT NULL,
  `CreatedAt` datetime NOT NULL DEFAULT current_timestamp()
) ;

--
-- Dumping data for table `stockmovement`
--

INSERT INTO `stockmovement` (`MovementID`, `ProductID`, `StaffID`, `MovementType`, `Quantity`, `Note`, `CreatedAt`) VALUES
(1, 2, 1, 'OUT', 20, 'Sale Needs many gloves', '2026-10-30 20:59:51'),
(2, 3, 1, 'OUT', 50, 'Sale Packing ape for totally legitimate reasons', '2026-10-30 21:01:28'),
(3, 7, 1, 'IN', 1000, 'For the big cook out', '2026-10-30 21:05:12'),
(4, 4, 1, 'OUT', 20, 'Sale SO-261102-00007', '2026-11-02 15:26:07');

-- --------------------------------------------------------

--
-- Table structure for table `suppliers`
--

CREATE TABLE `suppliers` (
  `SupplierID` int(10) UNSIGNED NOT NULL,
  `SupplierName` varchar(100) NOT NULL,
  `ContactPerson` varchar(100) NOT NULL DEFAULT '',
  `Phone` varchar(40) NOT NULL DEFAULT '',
  `Email` varchar(120) NOT NULL DEFAULT '',
  `Address` varchar(160) NOT NULL DEFAULT '',
  `IsActive` tinyint(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `transaction`
--

CREATE TABLE `transaction` (
  `TransactionID` int(10) UNSIGNED NOT NULL,
  `OrderID` int(10) UNSIGNED NOT NULL,
  `StaffID` int(10) UNSIGNED NOT NULL,
  `TransactionDate` datetime NOT NULL DEFAULT current_timestamp(),
  `AmountPaid` decimal(12,2) NOT NULL,
  `PaymentMethod` enum('Cash','Card','E-Wallet','Bank Transfer') NOT NULL DEFAULT 'Cash',
  `Change` decimal(12,2) NOT NULL DEFAULT 0.00
) ;

--
-- Dumping data for table `transaction`
--

INSERT INTO `transaction` (`TransactionID`, `OrderID`, `StaffID`, `TransactionDate`, `AmountPaid`, `PaymentMethod`, `Change`) VALUES
(1, 1, 1, '2026-10-27 21:59:40', 300.00, 'Cash', 30.03),
(2, 3, 2, '2026-10-28 17:02:54', 300.00, 'Cash', 30.03),
(3, 5, 1, '2026-10-30 20:59:51', 101.00, 'Cash', 0.20),
(4, 6, 1, '2026-10-30 21:01:28', 500.00, 'Card', 389.12),
(5, 7, 1, '2026-11-02 15:26:07', 270.00, 'E-Wallet', 1.20);

--
-- Indexes for dumped tables
--

--
-- Indexes for table `apitoken`
--
ALTER TABLE `apitoken`
  ADD PRIMARY KEY (`TokenID`),
  ADD UNIQUE KEY `uq_apitoken_hash` (`TokenHash`),
  ADD KEY `idx_apitoken_staff` (`StaffID`),
  ADD KEY `idx_apitoken_expires` (`ExpiresAt`);

--
-- Indexes for table `auditlog`
--
ALTER TABLE `auditlog`
  ADD PRIMARY KEY (`AuditID`),
  ADD KEY `idx_auditlog_created` (`CreatedAt`),
  ADD KEY `idx_auditlog_module` (`Module`),
  ADD KEY `idx_auditlog_staff` (`StaffID`);

--
-- Indexes for table `categories`
--
ALTER TABLE `categories`
  ADD PRIMARY KEY (`CategoryID`),
  ADD UNIQUE KEY `uq_categories_name` (`CategoryName`);

--
-- Indexes for table `inventory`
--
ALTER TABLE `inventory`
  ADD PRIMARY KEY (`InventoryID`),
  ADD UNIQUE KEY `uq_inventory_product` (`ProductID`);

--
-- Indexes for table `orderitem`
--
ALTER TABLE `orderitem`
  ADD PRIMARY KEY (`OrderItemID`),
  ADD UNIQUE KEY `uq_orderitem_order_product` (`OrderID`,`ProductID`),
  ADD KEY `idx_orderitem_product` (`ProductID`);

--
-- Indexes for table `orders`
--
ALTER TABLE `orders`
  ADD PRIMARY KEY (`OrderID`),
  ADD KEY `idx_orders_staff` (`StaffID`),
  ADD KEY `idx_orders_date` (`OrderDate`),
  ADD KEY `idx_orders_status` (`Status`);

--
-- Indexes for table `products`
--
ALTER TABLE `products`
  ADD PRIMARY KEY (`ProductID`),
  ADD UNIQUE KEY `uq_products_sku` (`SKU`),
  ADD UNIQUE KEY `uq_products_rackslot` (`RackSlot`),
  ADD KEY `idx_products_category` (`CategoryID`);

--
-- Indexes for table `sales`
--
ALTER TABLE `sales`
  ADD PRIMARY KEY (`SalesID`),
  ADD UNIQUE KEY `uq_sales_transaction` (`TransactionID`),
  ADD KEY `idx_sales_date` (`SaleDate`);

--
-- Indexes for table `salesreturn`
--
ALTER TABLE `salesreturn`
  ADD PRIMARY KEY (`ReturnID`),
  ADD KEY `idx_salesreturn_item` (`OrderItemID`),
  ADD KEY `idx_salesreturn_staff` (`StaffID`),
  ADD KEY `idx_salesreturn_status` (`Status`),
  ADD KEY `fk_salesreturn_reviewer` (`ReviewedBy`);

--
-- Indexes for table `staff`
--
ALTER TABLE `staff`
  ADD PRIMARY KEY (`StaffID`),
  ADD UNIQUE KEY `uq_staff_username` (`Username`);

--
-- Indexes for table `stockmovement`
--
ALTER TABLE `stockmovement`
  ADD PRIMARY KEY (`MovementID`),
  ADD KEY `idx_stockmovement_created` (`CreatedAt`),
  ADD KEY `idx_stockmovement_product` (`ProductID`),
  ADD KEY `idx_stockmovement_staff` (`StaffID`);

--
-- Indexes for table `suppliers`
--
ALTER TABLE `suppliers`
  ADD PRIMARY KEY (`SupplierID`),
  ADD UNIQUE KEY `uq_suppliers_name` (`SupplierName`);

--
-- Indexes for table `transaction`
--
ALTER TABLE `transaction`
  ADD PRIMARY KEY (`TransactionID`),
  ADD UNIQUE KEY `uq_transaction_order` (`OrderID`),
  ADD KEY `idx_transaction_staff` (`StaffID`),
  ADD KEY `idx_transaction_date` (`TransactionDate`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `apitoken`
--
ALTER TABLE `apitoken`
  MODIFY `TokenID` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- AUTO_INCREMENT for table `auditlog`
--
ALTER TABLE `auditlog`
  MODIFY `AuditID` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=21;

--
-- AUTO_INCREMENT for table `categories`
--
ALTER TABLE `categories`
  MODIFY `CategoryID` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=12;

--
-- AUTO_INCREMENT for table `inventory`
--
ALTER TABLE `inventory`
  MODIFY `InventoryID` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `orderitem`
--
ALTER TABLE `orderitem`
  MODIFY `OrderItemID` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `orders`
--
ALTER TABLE `orders`
  MODIFY `OrderID` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `products`
--
ALTER TABLE `products`
  MODIFY `ProductID` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `sales`
--
ALTER TABLE `sales`
  MODIFY `SalesID` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `salesreturn`
--
ALTER TABLE `salesreturn`
  MODIFY `ReturnID` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `staff`
--
ALTER TABLE `staff`
  MODIFY `StaffID` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `stockmovement`
--
ALTER TABLE `stockmovement`
  MODIFY `MovementID` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `suppliers`
--
ALTER TABLE `suppliers`
  MODIFY `SupplierID` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `transaction`
--
ALTER TABLE `transaction`
  MODIFY `TransactionID` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `apitoken`
--
ALTER TABLE `apitoken`
  ADD CONSTRAINT `fk_apitoken_staff` FOREIGN KEY (`StaffID`) REFERENCES `staff` (`StaffID`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `auditlog`
--
ALTER TABLE `auditlog`
  ADD CONSTRAINT `fk_auditlog_staff` FOREIGN KEY (`StaffID`) REFERENCES `staff` (`StaffID`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `inventory`
--
ALTER TABLE `inventory`
  ADD CONSTRAINT `fk_inventory_product` FOREIGN KEY (`ProductID`) REFERENCES `products` (`ProductID`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `orderitem`
--
ALTER TABLE `orderitem`
  ADD CONSTRAINT `fk_orderitem_order` FOREIGN KEY (`OrderID`) REFERENCES `orders` (`OrderID`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_orderitem_product` FOREIGN KEY (`ProductID`) REFERENCES `products` (`ProductID`) ON UPDATE CASCADE;

--
-- Constraints for table `orders`
--
ALTER TABLE `orders`
  ADD CONSTRAINT `fk_orders_staff` FOREIGN KEY (`StaffID`) REFERENCES `staff` (`StaffID`) ON UPDATE CASCADE;

--
-- Constraints for table `products`
--
ALTER TABLE `products`
  ADD CONSTRAINT `fk_products_category` FOREIGN KEY (`CategoryID`) REFERENCES `categories` (`CategoryID`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `sales`
--
ALTER TABLE `sales`
  ADD CONSTRAINT `fk_sales_transaction` FOREIGN KEY (`TransactionID`) REFERENCES `transaction` (`TransactionID`) ON UPDATE CASCADE;

--
-- Constraints for table `salesreturn`
--
ALTER TABLE `salesreturn`
  ADD CONSTRAINT `fk_salesreturn_item` FOREIGN KEY (`OrderItemID`) REFERENCES `orderitem` (`OrderItemID`) ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_salesreturn_reviewer` FOREIGN KEY (`ReviewedBy`) REFERENCES `staff` (`StaffID`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_salesreturn_staff` FOREIGN KEY (`StaffID`) REFERENCES `staff` (`StaffID`) ON UPDATE CASCADE;

--
-- Constraints for table `stockmovement`
--
ALTER TABLE `stockmovement`
  ADD CONSTRAINT `fk_stockmovement_product` FOREIGN KEY (`ProductID`) REFERENCES `products` (`ProductID`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_stockmovement_staff` FOREIGN KEY (`StaffID`) REFERENCES `staff` (`StaffID`) ON UPDATE CASCADE;

--
-- Constraints for table `transaction`
--
ALTER TABLE `transaction`
  ADD CONSTRAINT `fk_transaction_order` FOREIGN KEY (`OrderID`) REFERENCES `orders` (`OrderID`) ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_transaction_staff` FOREIGN KEY (`StaffID`) REFERENCES `staff` (`StaffID`) ON UPDATE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
