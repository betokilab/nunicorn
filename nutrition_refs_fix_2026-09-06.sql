-- 뉴니콘 영양 기준값 보정안 (2026-09-06)
-- 기준: 보건복지부·한국영양학회 KDRIs(2020 개정판 수치 기준으로 대조). 2025 개정판에서 값이 바뀐 항목이 있으면
--       소아과 전문의/임상영양사 검수 후 이 파일을 수정해 실행하세요.
-- 원칙: 앱의 연령 구간이 KDRIs 구간 2개 이상을 합칠 때(예: 6~12세 = 6~8세 + 9~11세)는 상한량은 낮은 쪽, 권장량은 낮은 쪽을 사용(보수적).
-- 실행 전 백업:  create table nutrition_references_bak_20260906 as select * from nutrition_references;

begin;

-- ── 비타민D (IU) ─ KDRIs 상한: 0~11개월 25㎍(1000IU) / 1~2세 30㎍(1200IU) / 3~5세 35㎍(1400IU) / 6~8세 40㎍(1600IU) / 9~11세 60㎍(2400IU)
--    권장(충분섭취량)은 전 연령 5㎍(200IU). 현재 DB는 상한이 과대(2000~3000IU)이고 6~12세 권장 400IU가 KDRIs와 다름.
update nutrition_references set upper_limit = 1200 where nutrient_key='vitD' and age_group_label in ('12~23개월','24~35개월');
update nutrition_references set upper_limit = 1400 where nutrient_key='vitD' and age_group_label = '36~71개월';
update nutrition_references set recommended_intake = 200, upper_limit = 1600 where nutrient_key='vitD' and age_group_label = '6~12세';

-- ── 아연 (mg) ─ 상한: 1~2세 6 / 3~5세 9 / 6~8세 13 / 9~11세 19. 권장: 1~2세 3 / 3~5세 4 / 6~8세 5 / 9~11세 8
update nutrition_references set upper_limit = 6 where nutrient_key='zinc' and age_group_label in ('12~23개월','24~35개월');

-- ── 마그네슘 (mg, 보충제 상한) ─ 1~2세 60 / 3~5세 90 / 6~8세 130 / 9~11세 190
update nutrition_references set upper_limit = 60  where nutrient_key='mg' and age_group_label in ('12~23개월','24~35개월');
update nutrition_references set upper_limit = 90  where nutrient_key='mg' and age_group_label = '36~71개월';
update nutrition_references set upper_limit = 130 where nutrient_key='mg' and age_group_label = '6~12세';

-- ── 비타민C (mg) ─ 상한: 1~2세 340 / 3~5세 510 / 6~8세 750 / 9~11세 1100
update nutrition_references set upper_limit = 340 where nutrient_key='vitC' and age_group_label in ('12~23개월','24~35개월');
update nutrition_references set upper_limit = 510 where nutrient_key='vitC' and age_group_label = '36~71개월';
update nutrition_references set upper_limit = 750 where nutrient_key='vitC' and age_group_label = '6~12세';

-- ── 비타민B6 (mg) ─ 상한: 1~2세 20 / 3~5세 30 / 6~8세 45 / 9~11세 60
update nutrition_references set upper_limit = 20 where nutrient_key='vitB6' and age_group_label in ('12~23개월','24~35개월');
update nutrition_references set upper_limit = 30 where nutrient_key='vitB6' and age_group_label = '36~71개월';

-- ── 비타민A (㎍ RAE) ─ 상한: 3~5세 750 / 6~8세 1100
update nutrition_references set upper_limit = 750  where nutrient_key='vitA' and age_group_label = '36~71개월';
update nutrition_references set upper_limit = 1100 where nutrient_key='vitA' and age_group_label = '6~12세';

commit;

-- 확인
select nutrient_key, age_group_label, recommended_intake, upper_limit, unit
from nutrition_references where nutrient_key in ('vitD','zinc','mg','vitC','vitB6','vitA') order by 1,2;
