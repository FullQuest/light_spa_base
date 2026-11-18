from random import uniform

n = 28
# Создаем матрицу 28x28, заполненную нулями
matrix = [[0] * n for _ in range(n)]

# Проходимся только по верхней треугольной части (без диагонали)
for i in range(n):
    for j in range(i + 1, n):
        val = uniform(0, 0.9)
        matrix[i][j] = val  # Верхняя часть
        matrix[j][i] = val  # Нижняя часть (зеркально)

# Преобразуем в кортежи, как в вашем исходном коде
matrix = tuple(tuple(row) for row in matrix)
print('matrix =', matrix)