-- MFTR_00053856_202602.pdf → Pilot Logbook DB 取り込み
-- 2026年2月 KUBOTA KN KENTARO 737COP
-- 34 flights + 1 SIM = 35 rows (DH1 2本はスキップ)
-- 15 rows/page × 3 pages = 45 slots (15+15+5)
-- FO モード前提: PUS flights → pic/picXC、CO flights → sic/xc

BEGIN TRANSACTION;

-- =========================================
-- Pages
-- =========================================
INSERT INTO pages (year, month, sub_index) VALUES (2026, '02', 1);
INSERT INTO pages (year, month, sub_index) VALUES (2026, '02', 2);
INSERT INTO pages (year, month, sub_index) VALUES (2026, '02', 3);

-- page_id を取得
-- ※ created_at 順で最後の3件が今作った Feb 2026 3 pages
-- 以降の INSERT では SELECT で page_id を参照

-- =========================================
-- Page 1 (2026-02-1): 15 rows
-- =========================================
-- row 0: 2/1 JL 0146 AOJ-HND 316J CO 1:22 N/T:30 I/T:30
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, night_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=1), 0, '2/1', NULL, NULL, 82, 82, 82, 30, 30, '316J', 'JL 0146', 'AOJ-HND');

-- row 1: 2/4 JL 0237 HND-OKJ 336J PUS 1:14 I/T:10 T/O=1
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, pic_min, pic_xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=1), 1, '2/4', 1, 1, 74, 74, 74, 10, '336J', 'JL 0237', 'HND-OKJ');

-- row 2: 2/4 JL 0240 OKJ-HND 336J PUS 1:09 N/T 1:09 I/T:10 (night 1/1)
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, pic_min, pic_xc_min, pic_nt_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=1), 2, '2/4', 1, 1, 69, 69, 69, 69, 10, '336J', 'JL 0240', 'OKJ-HND');

-- row 3: 2/4 JL 0443 HND-MYJ 336J PUS 1:28 N/T 1:28 I/T:10 (night 1/1)
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, pic_min, pic_xc_min, pic_nt_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=1), 3, '2/4', 1, 1, 88, 88, 88, 88, 10, '336J', 'JL 0443', 'HND-MYJ');

-- row 4: 2/5 JL 0436 MYJ-HND 318J PUS 1:24 I/T:10
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, pic_min, pic_xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=1), 4, '2/5', 1, 1, 84, 84, 84, 10, '318J', 'JL 0436', 'MYJ-HND');

-- row 5: 2/5 JL 0147 HND-AOJ 318J PUS 1:11 N/T 1:11 I/T:10 (night)
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, pic_min, pic_xc_min, pic_nt_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=1), 5, '2/5', 1, 1, 71, 71, 71, 71, 10, '318J', 'JL 0147', 'HND-AOJ');

-- row 6: 2/5 JL 0148 AOJ-HND 318J CO 1:18 N/T 1:18 I/T:10
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, night_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=1), 6, '2/5', NULL, NULL, 78, 78, 78, 78, 10, '318J', 'JL 0148', 'AOJ-HND');

-- row 7: 2/9 JL 0141 HND-AOJ 308J CO 1:28 I/T:20
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=1), 7, '2/9', NULL, NULL, 88, 88, 88, 20, '308J', 'JL 0141', 'HND-AOJ');

-- row 8: 2/9 JL 0142 AOJ-HND 308J CO 1:17 I/T:10
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=1), 8, '2/9', NULL, NULL, 77, 77, 77, 10, '308J', 'JL 0142', 'AOJ-HND');

-- row 9: 2/10 JL 3515 FUK-CTS 345J PUS 2:14 I/T:10
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, pic_min, pic_xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=1), 9, '2/10', 1, 1, 134, 134, 134, 10, '345J', 'JL 3515', 'FUK-CTS');

-- row 10: 2/10 JL 0520 CTS-HND 345J CO 1:43 N/T 1:43 I/T:10
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, night_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=1), 10, '2/10', NULL, NULL, 103, 103, 103, 103, 10, '345J', 'JL 0520', 'CTS-HND');

-- row 11: 2/10 JL 0599 HND-CTS 345J CO 1:36 N/T 1:36 I/T:10
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, night_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=1), 11, '2/10', NULL, NULL, 96, 96, 96, 96, 10, '345J', 'JL 0599', 'HND-CTS');

-- row 12: 2/11 JL 3512 CTS-FUK 323J PUS 2:28 I/T:20
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, pic_min, pic_xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=1), 12, '2/11', 1, 1, 148, 148, 148, 20, '323J', 'JL 3512', 'CTS-FUK');

-- row 13: 2/11 JL 0324 FUK-HND 323J CO 1:40 N/T 1:00 I/T:10
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, night_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=1), 13, '2/11', NULL, NULL, 100, 100, 100, 60, 10, '323J', 'JL 0324', 'FUK-HND');

-- row 14: 2/14 JL 0573 HND-OBO 340J CO 1:31
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=1), 14, '2/14', NULL, NULL, 91, 91, 91, '340J', 'JL 0573', 'HND-OBO');

-- =========================================
-- Page 2 (2026-02-2): 15 rows
-- =========================================
-- row 0: 2/14 JL 0570 OBO-HND 340J CO 1:42
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=2), 0, '2/14', NULL, NULL, 102, 102, 102, '340J', 'JL 0570', 'OBO-HND');

-- row 1: 2/14 JL 0117 HND-ITM 340J CO 1:05
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=2), 1, '2/14', NULL, NULL, 65, 65, 65, '340J', 'JL 0117', 'HND-ITM');

-- row 2: 2/15 JL 2001 ITM-CTS 337J CO 1:47 I/T:15
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=2), 2, '2/15', NULL, NULL, 107, 107, 107, 15, '337J', 'JL 2001', 'ITM-CTS');

-- row 3: 2/15 JL 3106 CTS-NGO 337J CO 1:40 I/T:15
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=2), 3, '2/15', NULL, NULL, 100, 100, 100, 15, '337J', 'JL 3106', 'CTS-NGO');

-- row 4: 2/16 JL 0202 NGO-HND 306J CO 0:58
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=2), 4, '2/16', NULL, NULL, 58, 58, 58, '306J', 'JL 0202', 'NGO-HND');

-- row 5: 2/16 JL 0607 HND-NGS 329J CO 2:13 I/T:30
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=2), 5, '2/16', NULL, NULL, 133, 133, 133, 30, '329J', 'JL 0607', 'HND-NGS');

-- row 6: 2/16 JL 0610 NGS-HND 329J CO 1:33 I/T:30
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=2), 6, '2/16', NULL, NULL, 93, 93, 93, 30, '329J', 'JL 0610', 'NGS-HND');

-- row 7: 2/17 SIM HND-HND 737 TRP 2:00 (T/O=3, L/D=3)
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, sim_min, aircraft, flight_no, route, notes)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=2), 7, '2/17', 3, 3, 120, '737', 'SIM', 'HND-HND', 'TRP');

-- row 8: 2/20 JL 0475 HND-TAK 308J PUS 1:24 I/T:10
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, pic_min, pic_xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=2), 8, '2/20', 1, 1, 84, 84, 84, 10, '308J', 'JL 0475', 'HND-TAK');

-- row 9: 2/20 JL 0476 TAK-HND 308J PUS 1:01 I/T:10
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, pic_min, pic_xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=2), 9, '2/20', 1, 1, 61, 61, 61, 10, '308J', 'JL 0476', 'TAK-HND');

-- row 10: 2/20 JL 0691 HND-KMI 308J PUS 1:43 I/T:10
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, pic_min, pic_xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=2), 10, '2/20', 1, 1, 103, 103, 103, 10, '308J', 'JL 0691', 'HND-KMI');

-- row 11: 2/21 JL 0694 KMI-HND 328J PUS 1:25 (no I/T)
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, pic_min, pic_xc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=2), 11, '2/21', 1, 1, 85, 85, 85, '328J', 'JL 0694', 'KMI-HND');

-- row 12: 2/21 JL 0147 HND-AOJ 328J PUS 1:15 N/T:30 (partial night landing)
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, pic_min, pic_xc_min, pic_nt_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=2), 12, '2/21', 1, 1, 75, 75, 75, 30, '328J', 'JL 0147', 'HND-AOJ');

-- row 13: 2/21 JL 0148 AOJ-HND 328J CO 1:15 N/T 1:15
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, night_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=2), 13, '2/21', NULL, NULL, 75, 75, 75, 75, '328J', 'JL 0148', 'AOJ-HND');

-- row 14: 2/22 JL 0809 NRT-TPE 320J CO 4:16 N/T 4:16 (all night)
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, night_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=2), 14, '2/22', NULL, NULL, 256, 256, 256, 256, '320J', 'JL 0809', 'NRT-TPE');

-- =========================================
-- Page 3 (2026-02-3): 5 rows
-- =========================================
-- row 0: 2/23 JL 0802 TPE-NRT 320J CO 3:03
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=3), 0, '2/23', NULL, NULL, 183, 183, 183, '320J', 'JL 0802', 'TPE-NRT');

-- row 1: 2/25 JL 0187 HND-KMQ 322J PUS 1:05 I/T:30
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, pic_min, pic_xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=3), 1, '2/25', 1, 1, 65, 65, 65, 30, '322J', 'JL 0187', 'HND-KMQ');

-- row 2: 2/26 JL 0182 KMQ-HND 318J PUS 1:15 I/T:10
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, pic_min, pic_xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=3), 2, '2/26', 1, 1, 75, 75, 75, 10, '318J', 'JL 0182', 'KMQ-HND');

-- row 3: 2/26 JL 0663 HND-OIT 318J PUS 1:33 I/T:10
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, pic_min, pic_xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=3), 3, '2/26', 1, 1, 93, 93, 93, 10, '318J', 'JL 0663', 'HND-OIT');

-- row 4: 2/26 JL 0668 OIT-HND 318J CO 1:26 I/T:10
INSERT INTO flights (page_id, row_index, date, takeoffs, landings, total_min, sic_min, xc_min, imc_min, aircraft, flight_no, route)
VALUES ((SELECT id FROM pages WHERE year=2026 AND month='02' AND sub_index=3), 4, '2/26', NULL, NULL, 86, 86, 86, 10, '318J', 'JL 0668', 'OIT-HND');

COMMIT;
