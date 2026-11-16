# Формулы

Простое выражение приведено в формуле @eq:plain:

$$\operatorname{Plain}(x)=x+1. (@eq:plain)$$

Дробь с суммой приведена в формуле @eq:brier:

$$\operatorname{Brier}=\frac{1}{N}\sum_{i=1}^{N}(p_i-y_i)^2. (@eq:brier)$$

Вложенная дробь приведена в формуле @eq:fraction:

$$\operatorname{Fraction}=\frac{1+\frac{a}{b}}{1+\frac{c}{d}}. (@eq:fraction)$$

Интеграл приведён в формуле @eq:integral:

$$\operatorname{Integral}=\int_0^1 x^2\,\mathrm{d}x. (@eq:integral)$$

Матрица приведена в формуле @eq:matrix:

$$\operatorname{Matrix}=\begin{bmatrix}1&2\\3&4\end{bmatrix}. (@eq:matrix)$$

Кусочная функция приведена в формуле @eq:cases:

$$\operatorname{Cases}(x)=\begin{cases}x^2,&x>0,\\0,&x\leq0.\end{cases} (@eq:cases)$$

Растягиваемые скобки приведены в формуле @eq:fences:

$$\operatorname{Fences}=\left(\frac{a}{b}\right)^2+\left[\frac{c}{d}\right]. (@eq:fences)$$

Векторы, матрицы и функции приведены в формуле @eq:roles:

$$\operatorname{Roles}=\stovec{a}\cdot\stovec{b}+\sin t+\stovec{x}^{\mathrm{T}}\stomat{A}\stovec{x}, (@eq:roles)$$

где $\stovec{a}$ – вектор;
$\stovec{b}$ – вектор той же размерности;
$t$ – скаляр;
$\stovec{x}$ – вектор той же размерности;
$\stomat{A}$ – квадратная матрица соответствующего порядка.

Перенос выражения показан в формуле @eq:continuation:

$$\begin{aligned}\operatorname{Start}&=a+b+\\&+c+d+\\&+\operatorname{Finish}=e+f.\end{aligned} (@eq:continuation)$$

Матрица внутри переноса приведена в формуле @eq:nested:

$$\begin{aligned}\operatorname{Nested}&=\begin{pmatrix}1&0\\0&1\end{pmatrix}+\\&+\operatorname{Last}=\frac{a}{b}.\end{aligned} (@eq:nested)$$

Ненумерованное выражение:

$$\operatorname{Unnumbered}=\sqrt{x^2+y^2}.$$

Высокие ветви кусочной функции приведены в формуле @eq:tallcases:

$$\operatorname{Tall}=\begin{cases}\frac{x_i^2+1}{y_i+1},&x_i>0,\\\frac{1}{1+\frac{a}{b}},&x_i\leq0,\;y_i\ne-1,\\0,&\text{иначе}.\end{cases} (@eq:tallcases)$$

Система уравнений и неравенств приведена в формуле @eq:system:

$$\operatorname{System}:\left\{\begin{aligned}x+y&=1,\\2x-y&=0,\\\frac{x}{y+1}&\geq0.\end{aligned}\right. (@eq:system)$$

Разные длины условий приведены в формуле @eq:conditions:

$$\operatorname{Conditions}=\begin{cases}x,&x>0,\\x^2+y^2,&x\leq0,\;y>0,\\0,&\text{в остальных случаях}.\end{cases} (@eq:conditions)$$

Группа с квадратными скобками приведена в формуле @eq:array:

$$\operatorname{Array}:\left[\begin{array}{rl}x+y&=1,\\2x-y&=0.\end{array}\right] (@eq:array)$$

Сумма со степенным слагаемым приведена в формуле @eq:mean_time:

$$\operatorname{MeanTime}=\bar{t}=\frac{1}{M}\sum_{m=1}^{M}t^{(m)},\quad M=20. (@eq:mean_time)$$

Crop interval boundaries:

$$y\in[0,4081H;0,9919H),\qquad x\in[0,0359W;0,9641W),$$

а для другой области границы изменяются:

$$y\in[0,3324H;0,9135H),\qquad x\in[0,0359W;0,9641W).$$

Prime attachment:

$$I^{'}=\operatorname{clip}(I+\varepsilon,0,1),\qquad\varepsilon\sim\operatorname{N}(0,\sigma^2).$$

Bare prime command:

$$I'=\operatorname{clip}(\alpha I+\beta,0,1).$$

Single-letter and extensible accents:

$$\operatorname{Accents}=\hat{d}_i+\widehat{d}_i+\widehat{abc}.$$

Empty upper summation limits:

$$\operatorname{SILog}=100\sqrt{\frac{1}{N}\sum_{i\in\Omega}^{}g_i^2-\left(\frac{1}{N}\sum_{i\in\Omega}^{}g_i\right)^2}.$$

Threshold domain:

$$\delta_j=\frac{1}{N}\left|\left\{i\in\Omega:\max\left(\frac{\hat{d}_i}{d_i},\frac{d_i}{\hat{d}_i}\right)<1,25^j\right\}\right|,\qquad j\in\{1,2,3\}.$$
