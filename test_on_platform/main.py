from random import uniform

matrix = []
for i in range(28):
    matrix.append([])
    for j in range(28):
        matrix[-1].append(uniform(0, 0.9))
    matrix[-1] = tuple(matrix[-1])

matrix = tuple(matrix)
print('matrix =', matrix)
