import pyperclip
from time import sleep

import pyautogui as pg
import time

pg.hotkey('alt', 'tab')

for i in range(2):
    pg.moveTo(853, 418, duration=0.2)
    pg.click()
    time.sleep(1)
    pg.moveTo(439, 141, duration=0.2)
    pg.click(clicks=2, interval=0.15)
    time.sleep(1)
    pg.moveTo(1093, 402, duration=0.2)
    pg.click()
    pg.moveTo(656, 311, duration=0.2)
    pg.dragTo(1100, 400, duration=0.2)
    pg.hotkey('ctrl', 'c')
    text = pyperclip.paste()
    all_time = text.split("потребуется: ")[1].split("\r")[0]  # для тестового json "21ч 17мин"
    result = text.split("Ваш результат: ")[1].split()[0]  # для тестового json " 31.2"
    print(all_time, result)
    sleep(1)
    pg.moveTo(781, 568, duration=0.2)
    pg.click()
    sleep(5)
