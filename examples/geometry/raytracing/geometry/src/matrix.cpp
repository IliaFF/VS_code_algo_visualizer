#include <raytracing/geometry/include/matrix.h>

Matrix::Matrix(size_t n) : Matrix(n, n) {
}

Matrix::Matrix(size_t m, size_t n) : rows_(m), columns_(n), data_(m * n, 0) {
}

Matrix::Matrix(const std::vector<std::vector<double>>& data)
    : Matrix(data.size(), data.empty() ? 0 : data.front().size()) {
    for (size_t i = 0; i < rows_; ++i) {
        for (size_t j = 0; j < columns_; ++j) {
            (*this)(i, j) = data[i][j];
        }
    }
}

size_t Matrix::Rows() const {
    return rows_;
}

size_t Matrix::Columns() const {
    return columns_;
}

double& Matrix::operator()(size_t i, size_t j) {
    return data_[i * columns_ + j];
}

double Matrix::operator()(size_t i, size_t j) const {
    return data_[i * columns_ + j];
}

Matrix& Matrix::operator+=(const Matrix& rhs) {
    for (size_t i = 0; i < data_.size(); ++i) {
        data_[i] += rhs.data_[i];
    }
    return *this;
}

Matrix& Matrix::operator-=(const Matrix& rhs) {
    for (size_t i = 0; i < data_.size(); ++i) {
        data_[i] -= rhs.data_[i];
    }
    return *this;
}

Matrix& Matrix::operator*=(const Matrix& rhs) {
    *this = *this * rhs;
    return *this;
}

Matrix Transpose(const Matrix& matrix) {
    Matrix result(matrix.Columns(), matrix.Rows());
    for (size_t i = 0; i < matrix.Rows(); ++i) {
        for (size_t j = 0; j < matrix.Columns(); ++j) {
            result(j, i) = matrix(i, j);
        }
    }
    return result;
}

Matrix operator+(Matrix lhs, const Matrix& rhs) {
    return lhs += rhs;
}

Matrix operator-(Matrix lhs, const Matrix& rhs) {
    return lhs -= rhs;
}

Matrix operator*(const Matrix& lhs, const Matrix& rhs) {
    Matrix result(lhs.Rows(), rhs.Columns());
    for (size_t i = 0; i < lhs.Rows(); ++i) {
        for (size_t j = 0; j < rhs.Columns(); ++j) {
            for (size_t k = 0; k < lhs.Columns(); ++k) {
                result(i, j) += lhs(i, k) * rhs(k, j);
            }
        }
    }
    return result;
}

Matrix Identity(size_t n) {
    Matrix result(n);
    for (size_t i = 0; i < n; ++i) {
        result(i, i) = 1;
    }
    return result;
}
