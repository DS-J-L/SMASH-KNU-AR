# 충돌·파편·소리 · 김태이 · T04/T08

구현 예정: `wrist-collision.js`의 손목 궤적·AABB/OBB, `destruction.js`의 Rapier 파편, `audio.js`의 Web Audio.

유효한 연속 두 관측으로만 선분을 만듭니다. 오래된 입력·가림·재연결은 궤적을 끊습니다. 타격 속도·cooldown은 파일럿으로 조정하며, 파괴된 건물은 재타격하지 않습니다. 키보드 데모는 실제 손목 입력과 분리합니다.

시작 버튼 동작으로 음향을 활성화하고 리셋 때 rigid body·collider·mesh·타이머를 정리합니다. 현재 물리 엔진은 설치·구현하지 않았습니다.
