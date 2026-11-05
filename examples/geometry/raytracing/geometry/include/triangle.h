#pragma once

#include <raytracing/geometry/include/vector.h>

#include <cstddef>
#include <array>

class Triangle {
public:
    Triangle();
    Triangle(const Vector& a, const Vector& b, const Vector& c);

    double Area() const;
    const Vector& operator[](size_t ind) const;

private:
    std::array<Vector, 3> vertices_{};
};
